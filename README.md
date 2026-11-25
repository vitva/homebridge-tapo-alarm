# Homebridge Tapo Alarm

[![Build and Lint](https://github.com/vitva/homebridge-tapo-alarm/actions/workflows/build.yml/badge.svg)](https://github.com/vitva/homebridge-tapo-alarm/actions/workflows/build.yml)
[![CodeQL](https://github.com/vitva/homebridge-tapo-alarm/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/vitva/homebridge-tapo-alarm/actions/workflows/codeql-analysis.yml)


Independent Tapo integration project for [Homebridge](https://github.com/homebridge/homebridge).

This project is derived from the archived [`homebridge-tp-link-tapo`](https://github.com/RaresAil/homebridge-tp-link-tapo) codebase, originally created by [Nicolae Rares Ailincai](https://github.com/RaresAil) and later maintained by [Kevin Hillinger](https://github.com/kevinhillinger).


|  |  |
|---------|-------------|
| Platform Name | `HomebridgeTapoAlarm` |
| | |

## Project goals

- Preserve Tapo H100 and physical S200 button support.
- Report actual H100 alarm state to HomeKit while keeping Tapo arming and siren control in the Tapo app.
- Keep the required HomeKit target-state characteristic limited to `DISARM`; HomeKit writes do not control the H100.
- Improve alarm-state polling and reliability while preserving upstream functionality.

### H100 alarm-state semantics

- The plugin reports the hub's live `in_alarm` flag. It does not infer an alarm from arming mode or from ringtone playback alone.
- `in_alarm` and `in_alarm_source` describe an alarm that is active now; the H100 does not expose a local history of past alarm events.
- If the hub omits `in_alarm` in a response, the plugin keeps the last known state rather than treating missing telemetry as an alarm-clear event.
- The current implementation samples `in_alarm` locally once per second; it does not use a push-event subscription. This is best-effort detection, so an alarm state that begins and clears between polls can be missed.
- The `in_alarm` flag is not guaranteed to stay true for the full ringtone playback time when the alarm duration is `Once`; do not treat audio playback duration as the alarm-state duration.

This is an independent derivative project and is not affiliated with TP-Link.

## Installation 

> CHILD BRIDGE: While not required, install this plugin as a Child Bridge for the best performance. Most of the time the response time between the app and the device is 80ms. With the official app, response times were 1-2 seconds.

### Current device types

- Socket/Outlet (For devices with power measurement, they have a contact sensor, open means the current is > 0 and closed is 0)
- Hub (As alarm)
- Button S200
- Contact Sensor (T110)
- Light Bulb
- LED Strip

For other device type just open a issue.

### Config

You can add multiple devices bulbs with a single platform.

```json
{
  "platforms": [
    {
      "platform": "HomebridgeTapoAlarm",
      "name": "Tapo Alarm",
      "email": "tplink-account-email",
      "password": "tplink-account-password",
      "addresses": [
        {
          "value": "192.168.1.100",
          "type": "IP"
        }
      ]
    }
  ]
}
```

## Development

Run the automated alarm-state and S200 event tests with:

```bash
npm test
```

The test suite covers missing alarm telemetry, alarm-state transitions, S200 startup baselines, repeated events, and invalid timestamps. GitHub Actions runs the tests on Node.js 20 and 22.

## Credits

- [Kevin Hillinger](https://github.com/kevinhillinger) - upstream plugin maintainer

- [Nicolae Rares Ailincai](https://github.com/RaresAil) - original author of the [`homebridge-tp-link-tapo`](https://github.com/RaresAil/homebridge-tp-link-tapo) plugin, which this plugin is forked from (*He is not affiliated nor contributes to this plugin*)
