#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"
#include "esp_wifi.h"
#include "esp_wifi_types.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT BIT1

esp_err_t wifi_manager_init(void);
// Start an AP with the given SSID. A NULL/empty password creates an open AP;
// a password creates a WPA2 AP and must be 8-63 characters long.
esp_err_t wifi_manager_start_ap(const char *ssid, const char *password);
esp_err_t wifi_manager_stop_ap(void);
// Return the stable AP SSID and load (or securely create) its NVS-backed WPA2
// password. Password generation happens only when the key is absent.
esp_err_t wifi_manager_get_ap_credentials(char *ssid, size_t ssid_len, char *password,
                                          size_t password_len);
esp_err_t wifi_manager_update_hostname(void);
// Toggle between full-RX performance (WIFI_PS_NONE, low latency / fast web UI)
// and modem power save (WIFI_PS_MIN_MODEM). Idempotent; safe to call every
// second. The policy for when to use which lives in power_manager.
esp_err_t wifi_manager_set_performance_mode(bool enable);
// Apply the configured IP mode to the STA netif (static address or DHCP).
// Called automatically by wifi_manager_connect; exposed for the provisioning
// connection test, which drives esp_wifi directly (#43).
esp_err_t wifi_manager_apply_ip_config(void);
esp_err_t wifi_manager_connect(const char *ssid, const char *password);
esp_err_t wifi_manager_disconnect(void);
bool wifi_manager_is_connected(void);
esp_err_t wifi_manager_get_ip(char *ip_str, size_t len);
esp_err_t wifi_manager_save_credentials(const char *ssid, const char *password);
esp_err_t wifi_manager_load_credentials(char *ssid, char *password);
esp_err_t wifi_manager_load_credentials_from_sdcard(char *ssid, char *password);
EventGroupHandle_t wifi_manager_get_event_group(void);
int wifi_manager_scan(wifi_ap_record_t *results, int max_results);

#endif
