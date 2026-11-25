import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic
} from 'homebridge';

import TapoAccessory, { ChildType } from './@types/TapoAccessory';
import { TapoAccessoryType } from './@types/TapoAccessoryType';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import DeviceInfo from './api/@types/DeviceInfo';
import Context from './@types/Context';
import TPLink from './api/TPLink';
import delay from './utils/delay';

import HubAccessory, { HubContext } from './accessories/Hub';
import LightBulbAccessory from './accessories/LightBulb';
import OutletAccessory from './accessories/Outlet';
import { ChildInfo } from './api/@types/ChildListInfo';
import ButtonAccessory from './accessories/Button';
import ContactAccessory from './accessories/Contact';
import MotionSensorAccessory from './accessories/MotionSensor';
import NetworkDeviceLocator from './network/network-device-locator';
import { NetworkAddressConfig } from './@types/network-address-config';
import { TapoDevice } from './tapo/tapo-device';

export default class Platform implements DynamicPlatformPlugin {
  private readonly TIMEOUT_TRIES = 20;

  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory<Context | HubContext>[] = [];
  public readonly loadedChildUUIDs: Record<string, true> = {};
  public readonly registeredDevices: TapoAccessory[] = [];
  public readonly hubs: HubAccessory[] = [];
  private readonly loadedParentUUIDs: Record<string, true> = {};

  private readonly deviceRetry: { [key: string]: number; } = {};
  private discoveryInFlight = false;
  private shuttingDown = false;
  private discoveryRetryTimer?: NodeJS.Timeout;

  deviceLocator: NetworkDeviceLocator;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    
    this.deviceLocator = new NetworkDeviceLocator(log, this.api.hap.uuid.generate);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.log.debug('Finished initializing platform:', this.config.name);

      this.removeCachedHiddenAccessories();
      void this.discoverDevices();
    });

    this.api.on('shutdown', () => {
      this.shuttingDown = true;
      if (this.discoveryRetryTimer) {
        clearTimeout(this.discoveryRetryTimer);
        this.discoveryRetryTimer = undefined;
      }
    });
  }

  /**
   * REQUIRED - Homebridge will call the "configureAccessory" method once for every cached
   * accessory restored
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory as PlatformAccessory<Context | HubContext>);
  }

  private isDeviceHidden(uuid: string): boolean {
    const hiddenDevices = Array.isArray(this.config?.hiddenDevices)
      ? this.config.hiddenDevices
      : [];
    return hiddenDevices.some((item: any) =>
      typeof item === 'string' ? item === uuid : item?.uuid === uuid
    );
  }

  private unregisterHiddenAccessory(accessory: PlatformAccessory<Context | HubContext>) {
    this.log.info('Hiding Tapo device from HomeKit:', accessory.displayName);
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    const index = this.accessories.indexOf(accessory);
    if (index !== -1) {
      this.accessories.splice(index, 1);
    }
  }

  private removeCachedHiddenAccessories() {
    const hiddenAccessories = this.accessories.filter((accessory) =>
      this.isDeviceHidden(accessory.UUID)
    );
    for (const accessory of hiddenAccessories) {
      this.unregisterHiddenAccessory(accessory);
    }
  }

  private async discoverDevices() {
    if (this.discoveryInFlight) {
      return;
    }

    this.discoveryInFlight = true;
    let discoveryComplete = false;

    try {
      const { email, password, addresses } = this.config ?? {};
      if (
        !email ||
        !password ||
        !addresses ||
        !Array.isArray(addresses) ||
        addresses.length <= 0
      ) {
        this.log.warn(
          'Tapo account credentials and at least one H100 address are required. Keeping cached accessories until configuration is complete.'
        );
        // An incomplete configuration is not evidence that cached devices
        // were removed. Preserve them and wait for a valid configuration.
        discoveryComplete = true;
        return;
      }

      // Track the actual accessory UUIDs resolved from the configured addresses.
      // IP addresses must not be converted directly to HomeKit UUIDs: discovery
      // resolves both IP and MAC entries to the device MAC before UUID creation.
      Object.keys(this.loadedParentUUIDs).forEach((uuid) => {
        delete this.loadedParentUUIDs[uuid];
      });

      const parentResults = await Promise.all(
        addresses.map((address) => this.loadDevice(address, email, password))
      );
      const allParentsFound = parentResults.every(Boolean);
      let allChildListsRead = true;

      if (allParentsFound) {
        // Build the child UUID set from this discovery pass only. Retaining
        // stale entries would prevent genuinely removed children being pruned.
        Object.keys(this.loadedChildUUIDs).forEach((uuid) => {
          delete this.loadedChildUUIDs[uuid];
        });

        for (const hub of this.hubs) {
          const devices = await hub.getChildDevices();
          if (!Array.isArray(devices)) {
            allChildListsRead = false;
            this.log.warn(
              'Unable to read child-device list; preserving cached accessories until the hub is reachable.'
            );
            continue;
          }

          const childResults = await Promise.all(
            devices.map(async (device) => {
              if (Object.keys(device || {}).length === 0) {
                return true;
              }

              const childUUID = this.api.hap.uuid.generate(device.device_id);
              const loaded = await this.loadChildDevice(
                device.device_id,
                device,
                hub
              );
              if (loaded) {
                this.loadedChildUUIDs[childUUID] = true;
              }
              return loaded;
            })
          );
          if (childResults.some((loaded) => !loaded)) {
            allChildListsRead = false;
          }
        }
      }

      discoveryComplete = allParentsFound && allChildListsRead;
      if (discoveryComplete) {
        this.checkOldDevices();
      } else {
        this.log.info(
          'Device discovery is incomplete; cached accessories will be kept and discovery will retry.'
        );
      }
    } catch (err: any) {
      this.log.error('Failed to discover devices:', err.message);
    } finally {
      this.discoveryInFlight = false;
      if (!this.shuttingDown && !discoveryComplete && !this.discoveryRetryTimer) {
        this.discoveryRetryTimer = setTimeout(() => {
          this.discoveryRetryTimer = undefined;
          void this.discoverDevices();
        }, 30 * 1000);
      }
    }
  }

  private async loadDevice(address: NetworkAddressConfig, email: string, password: string) {
    const networkDevice = await this.deviceLocator.find(address);

    if (!networkDevice) {
      this.log.info('Device is not currently reachable; discovery will retry:', address.value);
      return false;
    }
    const uuid = networkDevice.uuid;

    // A previous discovery pass may already have initialized this device.
    // Reuse it rather than creating duplicate Homebridge services or pollers.
    if (this.registeredDevices.some((device) => device.UUID === uuid)) {
      this.loadedParentUUIDs[uuid] = true;
      return true;
    }

    if (this.deviceRetry[uuid] === undefined) {
      this.deviceRetry[uuid] = this.TIMEOUT_TRIES;
    } else if (this.deviceRetry[uuid] <= 0) {
      this.log.info(
        'Connection attempts exhausted; will retry in a later discovery cycle:',
        networkDevice.ip,
        '|',
        networkDevice.mac
      );
      // Reset the bounded per-cycle retry budget so a device that comes back
      // after a longer outage can still be discovered without restarting HB.
      this.deviceRetry[uuid] = this.TIMEOUT_TRIES;
      return false;
    } else {
      this.log.info('Retry to connect in 10s', ':', networkDevice.ip);
      await delay(10 * 1000);

      this.log.info('Try for', networkDevice.ip,':',`${this.deviceRetry[uuid]}/${this.TIMEOUT_TRIES}`);
    }

    try {
      const tapoDevice = new TapoDevice(networkDevice, async (mac: string) => {
        const device = await this.deviceLocator.findByMac(mac);
        if (!device) {
          throw new Error(`Device with MAC ${mac} not found`);
        }
        return device.ip;
      }, this.log);

      const tpLink = await new TPLink(tapoDevice, email, password, this.log).setup();
      const deviceInfo = await tpLink.getInfo();
      if (Object.keys(deviceInfo || {}).length === 0) {
        this.log.error('Failed to get info about:', networkDevice.ip);
        this.deviceRetry[uuid] -= 1;
        return await this.loadDevice(address, email, password);
      }

      const deviceName = Buffer.from(
        deviceInfo?.nickname || 'Tm8gTmFtZQ==',
        'base64'
      ).toString('utf-8');

      const existingAccessory = this.accessories.find(
        (accessory) => accessory.UUID === uuid
      );

      if (existingAccessory) {
        this.log.info(
          'Restoring existing accessory from cache:',
          existingAccessory.displayName
        );
        existingAccessory.context = {
          ...existingAccessory.context,
          name: deviceName,
          tpLink,
          child: false,
          deviceId: networkDevice.mac,
          model: deviceInfo.model,
          deviceType: deviceInfo.type
        };
        this.api.updatePlatformAccessories([existingAccessory]);

        const tapoAccessory = this.createTapoAccessory(existingAccessory, deviceInfo);

        if (!tapoAccessory) {
          this.log.error(
            'Failed to register accessory "%s" of type "%s" (%s)',
            deviceName,
            TapoAccessory.getType(deviceInfo),
            deviceInfo?.type
          );
          return false;
        }

        this.registeredDevices.push(tapoAccessory);
        this.loadedParentUUIDs[uuid] = true;
        if (this.isDeviceHidden(uuid)) {
          this.unregisterHiddenAccessory(existingAccessory);
        }
        return true;
      }

      this.log.info('Adding new accessory:', deviceName);
      const accessory = new this.api.platformAccessory<Context>(
        deviceName,
        uuid
      );
      accessory.context = {
        name: deviceName,
        tpLink,
        child: false,
        deviceId: networkDevice.mac,
        model: deviceInfo.model,
        deviceType: deviceInfo.type
      };

      const registeredAccessory = this.createTapoAccessory(accessory, deviceInfo);
      if (!registeredAccessory) {
        this.log.error(
          'Failed to register accessory "%s" of type "%s" (%s)',
          deviceName,
          TapoAccessory.getType(deviceInfo),
          deviceInfo?.type
        );
        return false;
      }

      this.registeredDevices.push(registeredAccessory);
      this.loadedParentUUIDs[uuid] = true;

      if (this.isDeviceHidden(uuid)) {
        this.log.info('Device is hidden from HomeKit:', deviceName);
      } else {
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory
        ]);
      }
      return true;
    } catch (err: any) {
      this.log.error('Failed to get info about:', address, '|', err.message);
      this.deviceRetry[uuid] -= 1;
      return await this.loadDevice(address, email, password);
    }
  }

  private async loadChildDevice(
    id: string,
    deviceInfo: ChildInfo,
    parent: HubAccessory
  ) {
    const uuid = this.api.hap.uuid.generate(id);
    if (this.isDeviceHidden(uuid)) {
      const hiddenAccessory = this.accessories.find(
        (accessory) => accessory.UUID === uuid
      );
      if (hiddenAccessory) {
        this.unregisterHiddenAccessory(hiddenAccessory);
      }
      this.log.debug('Child device is hidden from HomeKit:', id);
      return true;
    }

    if (this.registeredDevices.some((device) => device.UUID === uuid)) {
      return true;
    }

    if (this.deviceRetry[uuid] === undefined) {
      this.deviceRetry[uuid] = this.TIMEOUT_TRIES;
    } else if (this.deviceRetry[uuid] <= 0) {
      this.log.info('Child connection attempts exhausted; will retry in a later discovery cycle:', id);
      this.deviceRetry[uuid] = this.TIMEOUT_TRIES;
      return false;
    } else {
      this.log.info('Retry to connect in 10s', ':', id);
      await delay(10 * 1000);
      this.log.info(
        'Try for',
        id,
        ':',
        `${this.deviceRetry[uuid]}/${this.TIMEOUT_TRIES}`
      );
    }

    try {
      const deviceName = Buffer.from(
        deviceInfo.nickname || 'Tm8gTmFtZQ==',
        'base64'
      ).toString('utf-8');

      const existingAccessory = this.accessories.find(
        (accessory) => accessory.UUID === uuid
      );

      if (existingAccessory) {
        this.log.info(
          'Restoring existing child accessory from cache:',
          existingAccessory.displayName
        );
        existingAccessory.context = {
          ...existingAccessory.context,
          name: deviceName,
          child: true,
          parent: parent.UUID,
          deviceId: id,
          model: deviceInfo.model,
          deviceType: deviceInfo.type
        };
        this.api.updatePlatformAccessories([existingAccessory]);

        const registeredAccessory = this.registerChild(
          existingAccessory,
          deviceInfo,
          parent
        );

        if (!registeredAccessory) {
          this.log.error(
            'Failed to register child accessory "%s" of type "%s" (%s)',
            deviceName,
            TapoAccessory.GetChildType(deviceInfo),
            deviceInfo?.type
          );
          return false;
        }

        this.registeredDevices.push(registeredAccessory);
        return true;
      }

      this.log.info('Adding new child accessory:', deviceName);
      const accessory = new this.api.platformAccessory<HubContext>(
        deviceName,
        uuid
      );
      accessory.context = {
        name: deviceName,
        child: true,
        parent: parent.UUID,
        deviceId: id,
        model: deviceInfo.model,
        deviceType: deviceInfo.type
      };

      const registeredAccessory = this.registerChild(
        accessory,
        deviceInfo,
        parent
      );
      if (!registeredAccessory) {
        this.log.error(
          'Failed to register child accessory "%s" of type "%s" (%s)',
          deviceName,
          TapoAccessory.GetChildType(deviceInfo),
          deviceInfo?.type
        );
        return false;
      }

      this.registeredDevices.push(registeredAccessory);

      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory
      ]);
      return true;
    } catch (err: any) {
      this.log.error('Failed to get info about child:', id, '|', err.message);
      this.deviceRetry[uuid] -= 1;
      return await this.loadChildDevice(id, deviceInfo, parent);
    }
  }

  private checkOldDevices() {
    this.accessories.map((accessory) => {
      const parentIsLoaded = !!this.loadedParentUUIDs[
        accessory.context.child
          ? accessory.context.parent
          : accessory.UUID.toString()
      ];
      const deleteDevice =
        !parentIsLoaded ||
        (accessory.context.child &&
          !this.loadedChildUUIDs[accessory.UUID.toString()]);

      if (deleteDevice) {
        this.log.info('Remove cached accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory
        ]);
      }
    });
  }

  private readonly accessoryClasses = {
    [TapoAccessoryType.LightBulb]: LightBulbAccessory,
    [TapoAccessoryType.Outlet]: OutletAccessory,
    [TapoAccessoryType.Hub]: HubAccessory
  };

  private createTapoAccessory(accessory: PlatformAccessory<Context | HubContext>, deviceInfo: DeviceInfo): TapoAccessory | null {
    const AccessoryType = this.accessoryClasses[TapoAccessory.getType(deviceInfo)];
    if (!AccessoryType) {
      return null;
    }

    const instance = new AccessoryType(this, accessory, this.log, deviceInfo);

    if (instance instanceof HubAccessory) {
      this.hubs.push(instance);
    }

    return instance;
  }

  private readonly childClasses = {
    [ChildType.Button]: ButtonAccessory,
    [ChildType.Contact]: ContactAccessory,
    [ChildType.MotionSensor]: MotionSensorAccessory,
  };

  private registerChild(
    accessory: PlatformAccessory<Context | HubContext>,
    deviceInfo: ChildInfo,
    parent: HubAccessory
  ): TapoAccessory | null {
    const ChildClass = this.childClasses[TapoAccessory.GetChildType(deviceInfo)];
    if (!ChildClass) {
      return null;
    }

    return new ChildClass(parent, this, accessory, this.log, deviceInfo);
  }
}
