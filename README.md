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

### S200 button events

- S200 single-click and double-click events are exposed through one HomeKit Stateless Programmable Switch service.
- On S200D, clockwise and counter-clockwise rotation are exposed as two additional Stateless Programmable Switch services, linked to the same accessory using HomeKit Service Labels.
- These are event triggers, not stateful switches: they do not remain on or off after an event.
- The plugin requests the 20 most recent H100 trigger-log entries and emits every unseen event in chronological order, using the unique log ID as its cursor. This avoids collapsing multiple events between polls and distinguishes events that share a timestamp.
- The event cursor is initialized from the current log so old events are not replayed after Homebridge starts. If the initial log request fails, the first successful response establishes the baseline.
- Event delivery remains best-effort and depends on the H100 retaining its trigger log entries until the next successful poll. The plugin polls once per second; it cannot recover events the hub no longer returns.

This is an independent derivative project and is not affiliated with TP-Link.

## Installation

Install through Homebridge UI or with `npm install -g homebridge-tapo-alarm`.

> CHILD BRIDGE: While not required, install this plugin as a Child Bridge for the best performance. Most of the time the response time between the app and the device is 80ms. With the official app, response times were 1-2 seconds.

### Current device types

- Socket/Outlet (For devices with power measurement, they have a contact sensor, open means the current is > 0 and closed is 0)
- Hub (As alarm)
- Button S200 / S200D
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

The test suite covers missing alarm telemetry, alarm-state transitions, S200 startup baselines, single/double clicks, S200D rotation direction, chronological delivery of multiple events, same-timestamp entries, repeated events, and invalid timestamps. GitHub Actions runs the tests on Node.js 20 and 22.

## Credits

- [Kevin Hillinger](https://github.com/kevinhillinger) - upstream plugin maintainer
- [Nicolae Rares Ailincai](https://github.com/RaresAil) - original author of the [`homebridge-tp-link-tapo`](https://github.com/RaresAil/homebridge-tp-link-tapo) plugin, which this plugin is derived from (*He is not affiliated nor contributes to this plugin*)
