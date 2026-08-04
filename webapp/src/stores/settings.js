import { defineStore } from "pinia";
import { ref, watch } from "vue";
import {
  getPreset,
  getPresetOptions,
  SPECTRA6,
  getDefaultParams,
} from "@aitjcize/epaper-image-convert";

export const useSettingsStore = defineStore("settings", () => {
  const API_BASE = "";

  // UI state
  const activeSettingsTab = ref("general");

  // Processing parameters
  const params = ref(getDefaultParams());

  // Device settings (UI representation)
  const deviceSettings = ref({
    // General
    deviceName: "PhotoFrame",
    timezoneOffset: 0,
    displayOrientation: "landscape",
    displayRotationDeg: 180,
    // Auto Rotate
    autoRotate: true,
    rotateCron: ["0 */12 *"],
    rotationMode: "storage",
    // Auto Rotate - SDCARD
    sdRotationMode: "random",
    // Auto Rotate - URL
    imageUrl: "https://loremflickr.com/800/480",
    caCertSet: false,
    lastFetchError: "",
    accessToken: "",
    httpHeaderKey: "",
    httpHeaderValue: "",
    saveDownloadedImages: true,
    // Power
    deepSleepEnabled: true,
    // Debugging
    debugLogEnabled: false,
  });

  // ... (existing code)

  // Original config from server (for change detection)
  let originalConfig = {};

  // Orientation as currently saved/applied on the device. The image preview uses
  // this (not the live dropdown) so it only re-lays-out when the user saves.
  const appliedOrientation = ref("landscape");

  let originalParams = {};

  // Palette - use defaults from epaper-image-convert library
  const palette = ref({ ...SPECTRA6.perceived });

  // Preset
  const preset = ref("balanced");

  // Get preset names from library (excluding "custom")
  const presetNames = getPresetOptions().map((p) => p.value);

  // Keys to compare for preset matching
  const presetKeys = [
    "exposure",
    "saturation",
    "toneMode",
    "contrast",
    "strength",
    "shadowBoost",
    "highlightCompress",
    "midpoint",
    "colorMethod",
    "ditherAlgorithm",
    "compressDynamicRange",
  ];

  function matchesPreset(presetName) {
    const target = getPreset(presetName);
    if (!target) return false;

    const current = params.value;
    for (const key of presetKeys) {
      if (!(key in target)) continue;
      const a = current[key];
      const b = target[key];
      // Compare numbers with a tolerance: the device persists floats as 32-bit,
      // so e.g. 1.4 round-trips as 1.39999998 and exact matching would never
      // detect the preset (it would fall back to "custom").
      if (typeof a === "number" && typeof b === "number") {
        if (Math.abs(a - b) > 1e-3) return false;
      } else if (a !== b) {
        return false;
      }
    }
    return true;
  }

  function derivePresetFromParams() {
    for (const name of presetNames) {
      if (matchesPreset(name)) return name;
    }
    return "custom";
  }

  // Actions
  function applyPreset(presetName) {
    const presetParams = getPreset(presetName);
    if (presetParams) {
      preset.value = presetName;
      // Copy only processing params (exclude name, title, description)
      // eslint-disable-next-line no-unused-vars
      const { name, title, description, ...processingParams } = presetParams;
      Object.assign(params.value, processingParams);
    }
  }

  // For a fresh grayscale frame (processing still at library defaults), default
  // to the grayscale preset, which is tuned for monochrome (LAB + s-curve).
  // A device that has already customized its settings is left untouched.
  function applyGrayscaleDefaultIfUntouched() {
    const def = getDefaultParams();
    const untouched = presetKeys.every((k) => !(k in def) || params.value[k] === def[k]);
    if (untouched) applyPreset("grayscale");
  }

  watch(
    params,
    () => {
      preset.value = derivePresetFromParams();
    },
    { deep: true }
  );

  async function loadSettings() {
    try {
      const response = await fetch(`${API_BASE}/api/settings/processing`);
      if (!response.ok || response.headers.get("content-type")?.includes("text/html")) {
        return;
      }
      const data = await response.json();
      Object.assign(params.value, data);
      // Store original params for change detection
      originalParams = JSON.parse(JSON.stringify(data));
    } catch (_error) {
      console.log("Settings API not available (standalone mode)");
    }
  }

  async function loadDeviceSettings() {
    try {
      const response = await fetch(`${API_BASE}/api/config`);
      if (!response.ok || response.headers.get("content-type")?.includes("text/html")) {
        return;
      }
      const data = await response.json();

      // Store original config for change detection
      originalConfig = JSON.parse(JSON.stringify(data));

      // Parse config into UI-friendly format
      deviceSettings.value.autoRotate = data.auto_rotate || false;

      // Rotation schedule: array of cron rules (fall back to the default).
      deviceSettings.value.rotateCron =
        Array.isArray(data.rotate_cron) && data.rotate_cron.length
          ? data.rotate_cron
          : ["0 */12 *"];

      deviceSettings.value.displayRotationDeg = data.display_rotation_deg ?? 180;
      deviceSettings.value.imageUrl = data.image_url || "https://loremflickr.com/800/480";
      deviceSettings.value.caCertSet = data.ca_cert_set || false;
      deviceSettings.value.lastFetchError = data.last_fetch_error || "";
      deviceSettings.value.deepSleepEnabled = data.deep_sleep_enabled !== false;
      deviceSettings.value.debugLogEnabled = data.debug_log_enabled === true;
      deviceSettings.value.saveDownloadedImages = data.save_downloaded_images !== false;
      deviceSettings.value.accessToken = data.access_token || "";
      deviceSettings.value.httpHeaderKey = data.http_header_key || "";
      deviceSettings.value.httpHeaderValue = data.http_header_value || "";
      deviceSettings.value.displayOrientation = data.display_orientation || "landscape";
      appliedOrientation.value = deviceSettings.value.displayOrientation;
      deviceSettings.value.rotationMode = data.rotation_mode || "storage";
      deviceSettings.value.sdRotationMode = data.sd_rotation_mode || "random";
      deviceSettings.value.deviceName = data.device_name || "PhotoFrame";

      // Parse timezone from POSIX format (e.g., "UTC-8" -> 8)
      const timezone = data.timezone || "UTC0";
      let offset = 0;
      const match = timezone.match(/UTC([+-]?)(\d+)(?::(\d+))?/);
      if (match) {
        const sign = match[1] === "-" ? 1 : -1; // POSIX format is inverted
        const hours = parseInt(match[2]) || 0;
        const minutes = parseInt(match[3]) || 0;
        offset = sign * (hours + minutes / 60);
      }
      deviceSettings.value.timezoneOffset = offset;
    } catch (_error) {
      console.log("Device settings API not available (standalone mode)");
    }
  }

  async function saveDeviceSettings() {
    // Convert UTC offset to POSIX timezone format
    const offsetValue = deviceSettings.value.timezoneOffset || 0;
    let timezone = "UTC0";
    if (offsetValue !== 0) {
      const absOffset = Math.abs(offsetValue);
      const hours = Math.floor(absOffset);
      const minutes = Math.round((absOffset - hours) * 60);
      const sign = offsetValue > 0 ? "-" : "+"; // Inverted for POSIX

      if (minutes === 0) {
        timezone = `UTC${sign}${hours}`;
      } else {
        timezone = `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
      }
    }

    const currentConfig = {
      auto_rotate: deviceSettings.value.autoRotate,
      rotate_cron: deviceSettings.value.rotateCron,
      display_rotation_deg: deviceSettings.value.displayRotationDeg,
      rotation_mode: deviceSettings.value.rotationMode,
      sd_rotation_mode: deviceSettings.value.sdRotationMode,
      image_url: deviceSettings.value.imageUrl,
      deep_sleep_enabled: deviceSettings.value.deepSleepEnabled,
      debug_log_enabled: deviceSettings.value.debugLogEnabled,
      save_downloaded_images: deviceSettings.value.saveDownloadedImages,
      display_orientation: deviceSettings.value.displayOrientation,
      device_name: deviceSettings.value.deviceName,
      timezone: timezone,
      access_token: deviceSettings.value.accessToken,
      http_header_key: deviceSettings.value.httpHeaderKey,
      http_header_value: deviceSettings.value.httpHeaderValue,
    };

    // Compare with original config and only send changed fields.
    // Arrays (rotate_cron) need a value comparison, not reference equality.
    const changedFields = {};
    for (const key in currentConfig) {
      const cur = currentConfig[key];
      const orig = originalConfig[key];
      const differs =
        Array.isArray(cur) || Array.isArray(orig)
          ? JSON.stringify(cur) !== JSON.stringify(orig)
          : cur !== orig;
      if (differs) {
        changedFields[key] = cur;
      }
    }

    // If nothing changed, return success
    if (Object.keys(changedFields).length === 0) {
      return { success: true, message: "No changes to save" };
    }

    // Save the remaining dashboard settings normally.
    try {
      const response = await fetch(`${API_BASE}/api/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changedFields),
      });

      const data = await response.json();

      if (data.status === "success") {
        // Update original config with new values
        Object.assign(originalConfig, changedFields);
        appliedOrientation.value = deviceSettings.value.displayOrientation;
        return { success: true, message: "Settings saved successfully" };
      } else {
        return { success: false, message: data.message || "Failed to save settings" };
      }
    } catch (error) {
      console.error("Error saving config:", error);
      return { success: false, message: "Error saving settings" };
    }
  }

  async function loadPalette() {
    try {
      const response = await fetch(`${API_BASE}/api/settings/palette`);
      if (!response.ok || response.headers.get("content-type")?.includes("text/html")) {
        return;
      }
      const data = await response.json();
      palette.value = data;
    } catch (_error) {
      console.log("Palette API not available (standalone mode)");
    }
  }

  function hasProcessingSettingsChanged() {
    const current = params.value;
    for (const key of presetKeys) {
      if (current[key] !== originalParams[key]) {
        return true;
      }
    }
    return false;
  }

  async function saveSettings() {
    // Skip save if nothing changed
    if (!hasProcessingSettingsChanged()) {
      return true;
    }

    try {
      const response = await fetch(`${API_BASE}/api/settings/processing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params.value),
      });
      if (response.ok) {
        // Update original params after successful save
        originalParams = JSON.parse(JSON.stringify(params.value));
      }
      return response.ok;
    } catch (_error) {
      console.error("Failed to save settings:", error);
      return false;
    }
  }

  async function savePalette() {
    try {
      const response = await fetch(`${API_BASE}/api/settings/palette`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(palette.value),
      });
      return response.ok;
    } catch (_error) {
      console.error("Failed to save palette:", error);
      return false;
    }
  }

  async function factoryReset() {
    try {
      const response = await fetch(`${API_BASE}/api/factory-reset`, {
        method: "POST",
      });

      if (response.ok) {
        return {
          success: true,
          message: "Factory reset successful. Device is restarting with a new hotspot password.",
        };
      } else {
        return { success: false, message: "Failed to perform factory reset" };
      }
    } catch (_error) {
      console.error("Error performing factory reset:", error);
      return { success: false, message: "Error performing factory reset" };
    }
  }

  return {
    activeSettingsTab,
    params,
    deviceSettings,
    appliedOrientation,
    palette,
    preset,
    presetNames,
    applyPreset,
    applyGrayscaleDefaultIfUntouched,
    loadSettings,
    loadDeviceSettings,
    saveDeviceSettings,

    loadPalette,
    saveSettings,
    savePalette,
    factoryReset,
  };
});
