<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useSettingsStore, useAppStore } from "../stores";
import PaletteCalibration from "./PaletteCalibration.vue";
import GrayscaleCalibration from "./GrayscaleCalibration.vue";
import ProcessingControls from "./ProcessingControls.vue";
import RotationSchedule from "./RotationSchedule.vue";
import { isValidCron } from "../utils/cron";
import { wideEdit } from "../utils/uiPrefs";

const settingsStore = useSettingsStore();
const appStore = useAppStore();

// The device rejects the entire config request when any schedule rule is
// invalid, empty or over the 7-rule budget — gate saving on the same checks.
const scheduleValid = computed(() => {
  const rules = settingsStore.deviceSettings.rotateCron || [];
  return rules.length >= 1 && rules.length <= 7 && rules.every((r) => isValidCron(r));
});

// Device time state
const deviceTime = ref("");
const syncingTime = ref(false);
let deviceTimestamp = null; // Unix timestamp from device
let localTimeOffset = 0; // Offset between device time and local time
let tickInterval = null;

function updateDisplayTime() {
  if (deviceTimestamp === null) return;
  // Calculate current device time based on elapsed local time
  const elapsed = Math.floor((Date.now() - localTimeOffset) / 1000);
  const currentTimestamp = deviceTimestamp + elapsed;

  // Apply timezone offset for display
  // We shift the timestamp by the offset so that toISOString() (which is UTC)
  // displays the correct local time numbers.
  const offsetHours = settingsStore.deviceSettings.timezoneOffset || 0;
  const adjustedTimestamp = currentTimestamp + offsetHours * 3600;

  const date = new Date(adjustedTimestamp * 1000);
  // Format as YYYY-MM-DD HH:MM:SS
  deviceTime.value = date.toISOString().slice(0, 19).replace("T", " ");
}

async function parseTimezone(timezoneStr) {
  if (!timezoneStr) return;

  // Posix format: UTC[+/-]H[:MM] (e.g., UTC-8 or UTC+5:30)
  // Note: POSIX sign is inverted relative to ISO8601
  let offset = 0;
  const match = timezoneStr.match(/UTC([+-]?)(\d+)(?::(\d+))?/);
  if (match) {
    const sign = match[1] === "-" ? 1 : -1; // POSIX Inverted
    const hours = parseInt(match[2]) || 0;
    const minutes = parseInt(match[3]) || 0;
    offset = sign * (hours + minutes / 60);

    // Update store if different, to keep UI in sync
    if (settingsStore.deviceSettings.timezoneOffset !== offset) {
      settingsStore.deviceSettings.timezoneOffset = offset;
    }
  }
}

async function fetchDeviceTime() {
  try {
    const response = await fetch("/api/time");
    if (response.ok) {
      const data = await response.json();
      deviceTimestamp = data.timestamp;
      localTimeOffset = Date.now();
      await parseTimezone(data.timezone);
      updateDisplayTime();
    }
  } catch (error) {
    console.error("Failed to fetch device time:", error);
  }
}

async function syncTime() {
  syncingTime.value = true;
  try {
    const response = await fetch("/api/time/sync", { method: "POST" });
    if (response.ok) {
      const data = await response.json();
      if (data.status === "success") {
        deviceTimestamp = data.timestamp;
        localTimeOffset = Date.now();
        await parseTimezone(data.timezone);
        updateDisplayTime();
      }
    }
  } catch (error) {
    console.error("Failed to sync time:", error);
  } finally {
    syncingTime.value = false;
  }
}

onMounted(() => {
  fetchDeviceTime();
  // Tick every second to update display
  tickInterval = setInterval(updateDisplayTime, 1000);
});

onUnmounted(() => {
  if (tickInterval) {
    clearInterval(tickInterval);
  }
});

const tab = computed({
  get: () => settingsStore.activeSettingsTab,
  set: (val) => (settingsStore.activeSettingsTab = val),
});

const orientationOptions = computed(() => {
  const width = appStore.systemInfo.width || 800;
  const height = appStore.systemInfo.height || 480;
  const maxDim = Math.max(width, height);
  const minDim = Math.min(width, height);

  return [
    { title: `Landscape (${maxDim}×${minDim})`, value: "landscape" },
    { title: `Portrait (${minDim}×${maxDim})`, value: "portrait" },
  ];
});

const rotationOptions = [
  { title: "0°", value: 0 },
  { title: "90°", value: 90 },
  { title: "180°", value: 180 },
  { title: "270°", value: 270 },
];

const sdRotationModeOptions = [
  { title: "Random - Shuffle images", value: "random" },
  { title: "Sequential - In sequence", value: "sequential" },
];

const saving = ref(false);
const saveSuccess = ref(false);

function onPresetChange(preset) {
  if (preset !== "custom") {
    settingsStore.applyPreset(preset);
  }
}

function onParamsUpdate(newParams) {
  Object.assign(settingsStore.params, newParams);
}

const saveMessage = ref("");
const saveError = ref(false);

const showFactoryResetDialog = ref(false);
const resetting = ref(false);
const showImportDialog = ref(false);
const importData = ref(null);
const importFileName = ref("");

async function exportConfig() {
  try {
    const [configRes, processingRes, paletteRes] = await Promise.all([
      fetch("/api/config"),
      fetch("/api/settings/processing"),
      fetch("/api/settings/palette"),
    ]);

    const exported = {};

    if (configRes.ok) {
      const config = await configRes.json();
      // Remove sensitive fields
      delete config.wifi_password;
      exported.config = config;
    }
    if (processingRes.ok) exported.processing = await processingRes.json();
    if (paletteRes.ok) exported.palette = await paletteRes.json();

    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const deviceName = settingsStore.deviceSettings.deviceName || "photoframe";
    a.download = `${deviceName.toLowerCase().replace(/\s+/g, "-")}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Failed to export config:", error);
  }
}

const downloadingLog = ref(false);

async function downloadDebugLog() {
  downloadingLog.value = true;
  try {
    const response = await fetch("/api/debug/log");
    if (!response.ok) {
      saveError.value = true;
      saveMessage.value = "No debug logs available";
      setTimeout(() => (saveError.value = false), 5000);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const deviceName = settingsStore.deviceSettings.deviceName || "photoframe";
    a.download = `${deviceName.toLowerCase().replace(/\s+/g, "-")}-debug.log`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Failed to download debug log:", error);
    saveError.value = true;
    saveMessage.value = "Failed to download debug logs";
    setTimeout(() => (saveError.value = false), 5000);
  } finally {
    downloadingLog.value = false;
  }
}

const clearingLog = ref(false);

async function clearDebugLog() {
  clearingLog.value = true;
  try {
    const response = await fetch("/api/debug/log", { method: "DELETE" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    saveSuccess.value = true;
    saveMessage.value = "Debug logs cleared";
    setTimeout(() => (saveSuccess.value = false), 3000);
  } catch (error) {
    console.error("Failed to clear debug logs:", error);
    saveError.value = true;
    saveMessage.value = "Failed to clear debug logs";
    setTimeout(() => (saveError.value = false), 5000);
  } finally {
    clearingLog.value = false;
  }
}

function onImportFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  importFileName.value = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      importData.value = JSON.parse(e.target.result);
      showImportDialog.value = true;
    } catch {
      saveError.value = true;
      saveMessage.value = "Invalid JSON file";
      setTimeout(() => (saveError.value = false), 5000);
    }
  };
  reader.readAsText(file);
  // Reset input so the same file can be selected again
  event.target.value = "";
}

async function performImport() {
  if (!importData.value) return;

  showImportDialog.value = false;
  saving.value = true;

  try {
    const promises = [];

    if (importData.value.config) {
      promises.push(
        fetch("/api/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(importData.value.config),
        })
      );
    }
    if (importData.value.processing) {
      promises.push(
        fetch("/api/settings/processing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(importData.value.processing),
        })
      );
    }
    if (importData.value.palette) {
      promises.push(
        fetch("/api/settings/palette", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(importData.value.palette),
        })
      );
    }

    await Promise.all(promises);

    // Reload all settings from device
    await Promise.all([
      settingsStore.loadDeviceSettings(),
      settingsStore.loadSettings(),
      settingsStore.loadPalette(),
    ]);

    saveSuccess.value = true;
    saveError.value = false;
    saveMessage.value = "Config imported successfully!";
    setTimeout(() => (saveSuccess.value = false), 3000);
  } catch (error) {
    console.error("Failed to import config:", error);
    saveError.value = true;
    saveMessage.value = "Failed to import config";
    setTimeout(() => (saveError.value = false), 5000);
  } finally {
    saving.value = false;
    importData.value = null;
  }
}

async function saveSettings() {
  saving.value = true;

  // Save both device settings and processing settings
  const [deviceResult, processingSuccess] = await Promise.all([
    settingsStore.saveDeviceSettings(),
    settingsStore.saveSettings(),
  ]);

  saving.value = false;

  if (deviceResult.success && processingSuccess) {
    saveSuccess.value = true;
    saveError.value = false;
    saveMessage.value = deviceResult.message || "Settings saved!";
    setTimeout(() => (saveSuccess.value = false), 3000);

    // Refresh device time in case timezone changed
    await fetchDeviceTime();
  } else {
    // Show error message
    saveError.value = true;
    saveSuccess.value = false;
    saveMessage.value = deviceResult.message || "Failed to save settings";
    setTimeout(() => (saveError.value = false), 5000);
  }
}

async function performFactoryReset() {
  resetting.value = true;
  const result = await settingsStore.factoryReset();
  resetting.value = false;
  showFactoryResetDialog.value = false;

  if (result.success) {
    saveSuccess.value = true;
    saveError.value = false;
    saveMessage.value = result.message;
    setTimeout(() => (saveSuccess.value = false), 3000);
  } else {
    saveError.value = true;
    saveSuccess.value = false;
    saveMessage.value = result.message;
    setTimeout(() => (saveError.value = false), 5000);
  }
}
</script>

<template>
  <div>
    <v-card style="overflow: visible">
      <v-card-title class="d-flex align-center">
        <v-icon icon="mdi-cog" class="mr-2" />
        Settings
      </v-card-title>

      <v-tabs v-model="tab" color="primary" show-arrows density="compact">
        <v-tab value="general"> General </v-tab>
        <v-tab value="autoRotate"> Auto Rotate </v-tab>
        <v-tab value="power"> Power </v-tab>
        <v-tab value="processing"> Processing </v-tab>
        <v-tab value="calibration">
          {{ appStore.isGrayscale ? "Grayscale" : "Palette" }}
        </v-tab>
        <v-tab value="maintenance"> Maintenance </v-tab>
      </v-tabs>

      <v-card-text>
        <v-tabs-window v-model="tab">
          <!-- General Tab -->
          <v-tabs-window-item value="general">
            <v-row class="mt-2">
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="settingsStore.deviceSettings.deviceName"
                  label="Device Name"
                  variant="outlined"
                  hint="Used for mDNS hostname (e.g., 'Living Room Frame' → living-room-frame.local)"
                  persistent-hint
                />
              </v-col>
            </v-row>

            <v-row>
              <v-col cols="12" md="6">
                <v-select
                  v-model="settingsStore.deviceSettings.displayOrientation"
                  :items="orientationOptions"
                  item-title="title"
                  item-value="value"
                  label="Display Orientation"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-select
                  v-model="settingsStore.deviceSettings.displayRotationDeg"
                  :items="rotationOptions"
                  item-title="title"
                  item-value="value"
                  label="Display Rotation (deg)"
                  variant="outlined"
                />
              </v-col>
            </v-row>

            <v-row>
              <v-col cols="12" md="6">
                <v-text-field
                  :model-value="deviceTime || 'Loading...'"
                  label="Device Time"
                  variant="outlined"
                  readonly
                  hint="Click sync to update from NTP server"
                  persistent-hint
                >
                  <template #append-inner>
                    <v-btn
                      icon
                      variant="text"
                      size="small"
                      :loading="syncingTime"
                      @click="syncTime"
                    >
                      <v-icon>mdi-sync</v-icon>
                      <v-tooltip activator="parent" location="top">Sync NTP</v-tooltip>
                    </v-btn>
                  </template>
                </v-text-field>
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model.number="settingsStore.deviceSettings.timezoneOffset"
                  label="Timezone (UTC offset)"
                  type="number"
                  :min="-12"
                  :max="14"
                  :step="0.5"
                  variant="outlined"
                  hint="e.g., -8 for PST, +1 for CET, +8 for CST"
                  persistent-hint
                />
              </v-col>
            </v-row>
          </v-tabs-window-item>

          <!-- Auto Rotate Tab -->
          <v-tabs-window-item value="autoRotate">
            <v-switch
              v-model="settingsStore.deviceSettings.autoRotate"
              label="Enable Auto-Rotate"
              color="primary"
              class="mb-2"
              hide-details
            />

            <div class="ml-10">
              <RotationSchedule
                v-model="settingsStore.deviceSettings.rotateCron"
                :disabled="!settingsStore.deviceSettings.autoRotate"
              />

              <v-expand-transition>
                <v-card
                  v-if="
                    settingsStore.deviceSettings.autoRotate &&
                    (appStore.systemInfo.sdcard_inserted || appStore.systemInfo.has_flash_storage)
                  "
                  variant="tonal"
                  class="mt-8 mb-4"
                >
                  <v-card-text>
                    <v-select
                      v-model="settingsStore.deviceSettings.sdRotationMode"
                      :items="sdRotationModeOptions"
                      item-title="title"
                      item-value="value"
                      label="Storage Rotation Logic"
                      variant="outlined"
                      hide-details
                    />
                  </v-card-text>
                </v-card>
              </v-expand-transition>
            </div>
          </v-tabs-window-item>

          <!-- Power Tab -->
          <v-tabs-window-item value="power">
            <v-switch
              v-model="settingsStore.deviceSettings.deepSleepEnabled"
              label="Enable Deep Sleep"
              color="primary"
              class="mb-4"
            />

            <v-expand-transition>
              <v-alert
                v-if="!settingsStore.deviceSettings.deepSleepEnabled"
                type="warning"
                variant="tonal"
              >
                <strong>Power Consumption Notice</strong><br />
                Disabling deep sleep keeps the HTTP server accessible but significantly increases
                power consumption. Only disable if permanently powered via USB.
              </v-alert>
            </v-expand-transition>
          </v-tabs-window-item>

          <!-- Processing Tab -->
          <v-tabs-window-item value="processing">
            <div class="pa-4">
              <v-alert v-if="wideEdit" type="info" variant="tonal" density="compact">
                Processing controls are shown next to the preview in wide-edit mode. Turn wide edit
                off (the split icon on the Upload card) to edit them here.
              </v-alert>
              <ProcessingControls
                v-else
                :params="settingsStore.params"
                :preset="settingsStore.preset"
                @update:params="onParamsUpdate"
                @update:preset="settingsStore.preset = $event"
                @preset-change="onPresetChange"
              />
            </div>
          </v-tabs-window-item>

          <!-- Calibration Tab -->
          <v-tabs-window-item value="calibration">
            <GrayscaleCalibration v-if="appStore.isGrayscale" />
            <PaletteCalibration v-else />
          </v-tabs-window-item>

          <!-- Maintenance Tab -->
          <v-tabs-window-item value="maintenance">
            <div class="text-subtitle-1 mt-2 mb-4">Config Backup</div>
            <v-row>
              <v-col cols="12">
                <v-btn variant="outlined" class="mr-2" @click="exportConfig">
                  <v-icon start>mdi-download</v-icon>
                  Export Config
                </v-btn>
                <v-btn variant="outlined" @click="$refs.importInput.click()">
                  <v-icon start>mdi-upload</v-icon>
                  Import Config
                </v-btn>
                <input
                  ref="importInput"
                  type="file"
                  accept=".json"
                  style="display: none"
                  @change="onImportFileSelected"
                />
              </v-col>
            </v-row>

            <v-divider class="my-6" />

            <div class="text-subtitle-1 mb-4">Debug Logging</div>
            <v-row>
              <v-col cols="12">
                <v-switch
                  v-model="settingsStore.deviceSettings.debugLogEnabled"
                  label="Save console logs to storage"
                  color="primary"
                  hide-details
                  class="mb-2"
                />
                <v-expand-transition>
                  <v-alert
                    v-if="settingsStore.deviceSettings.debugLogEnabled"
                    type="info"
                    variant="tonal"
                    density="compact"
                    class="mb-4"
                  >
                    Serial console output is mirrored to the SD card, keeping only the most recent
                    lines. Takes effect after saving.
                  </v-alert>
                </v-expand-transition>
                <v-btn
                  variant="outlined"
                  class="mr-2"
                  :loading="downloadingLog"
                  @click="downloadDebugLog"
                >
                  <v-icon start>mdi-download</v-icon>
                  Download Logs
                </v-btn>
                <v-btn variant="outlined" :loading="clearingLog" @click="clearDebugLog">
                  <v-icon start>mdi-delete</v-icon>
                  Clear Logs
                </v-btn>
              </v-col>
            </v-row>

            <v-divider class="my-6" />

            <div class="text-subtitle-1 mb-4">Factory Reset</div>
            <v-row>
              <v-col cols="12">
                <v-btn color="error" variant="outlined" @click="showFactoryResetDialog = true">
                  <v-icon start>mdi-restore-alert</v-icon>
                  Factory Reset Device
                </v-btn>
              </v-col>
            </v-row>
          </v-tabs-window-item>
        </v-tabs-window>
      </v-card-text>

      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-fade-transition>
          <v-chip v-if="saveSuccess" color="success" variant="tonal">
            <v-icon icon="mdi-check" start />
            {{ saveMessage || "Settings saved!" }}
          </v-chip>
          <v-chip v-else-if="saveError" color="error" variant="tonal">
            <v-icon icon="mdi-alert-circle" start />
            {{ saveMessage || "Failed to save settings" }}
          </v-chip>
        </v-fade-transition>
        <v-tooltip
          text="Fix the rotation schedule first (invalid or too many rules)"
          location="top"
          :disabled="scheduleValid"
        >
          <template #activator="{ props: tooltipProps }">
            <span v-bind="tooltipProps">
              <v-btn
                color="primary"
                :loading="saving"
                :disabled="!scheduleValid"
                @click="saveSettings"
              >
                <v-icon icon="mdi-content-save" start />
                Save Settings
              </v-btn>
            </span>
          </template>
        </v-tooltip>
      </v-card-actions>
    </v-card>

    <!-- Factory Reset Confirmation Dialog -->
    <v-dialog v-model="showFactoryResetDialog" max-width="500">
      <v-card>
        <v-card-title class="text-h5 text-error">
          <v-icon icon="mdi-alert" class="mr-2" />
          Confirm Factory Reset
        </v-card-title>
        <v-card-text>
          <v-alert type="error" variant="tonal" class="mb-4">
            <div class="text-subtitle-2 mb-2">This action is irreversible!</div>
            <div class="text-body-2">
              All device settings will be permanently erased, including:
            </div>
            <ul class="mt-2">
              <li>Stored hotspot password</li>
              <li>Image processing settings</li>
              <li>Device configuration</li>
              <li>All custom settings</li>
            </ul>
          </v-alert>
          <div class="text-body-1 mb-3">
            The device will restart and return to factory defaults. Are you sure you want to
            continue?
          </div>
          <v-alert type="info" variant="tonal" density="compact">
            <div class="text-body-2">
              <strong>After reset:</strong> The device will generate a new hotspot password and show
              the connection QR code on its setup screen.
            </div>
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showFactoryResetDialog = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" :loading="resetting" @click="performFactoryReset">
            Reset Device
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <!-- Import Config Confirmation Dialog -->
    <v-dialog v-model="showImportDialog" max-width="500">
      <v-card>
        <v-card-title>
          <v-icon icon="mdi-upload" class="mr-2" />
          Import Config
        </v-card-title>
        <v-card-text>
          <v-alert type="warning" variant="tonal" class="mb-4">
            This will overwrite your current settings with the imported config.
          </v-alert>
          <div class="text-body-2 mb-2">
            File: <strong>{{ importFileName }}</strong>
          </div>
          <div v-if="importData" class="text-body-2">
            Sections to import:
            <ul class="mt-1 ml-4">
              <li v-if="importData.config">Device settings</li>
              <li v-if="importData.processing">Processing settings</li>
              <li v-if="importData.palette">Palette calibration</li>
            </ul>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showImportDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="performImport"> Import </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped></style>
