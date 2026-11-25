import find from 'local-devices';
import { Logger } from 'homebridge';
import { NetworkAddressConfig } from '../@types/network-address-config';
import { NetworkDevice } from '../@types/network-device';

class NetworkDeviceLocator {
  constructor(
    private readonly log: Logger,
    private readonly uuidFactory: (address: string) => string
  ) {}

  public async find(address: NetworkAddressConfig): Promise<NetworkDevice | null> {
    if (!address) {
      this.log.error('No address provided');
      return null;
    }

    if (address.type === 'IP') {
      return this.findByIp(address.value);
    }

    if (address.type === 'MAC') {
      return this.findByMac(address.value);
    }

    this.log.error('Unsupported address type:', address.type);
    return null;
  }

  private async findByIp(ipAddress: string): Promise<NetworkDevice | null> {
    try {
      this.log.info('Locating device by IP address:', ipAddress);
      const devices = await find();
      const device = devices.find((item) => item.ip === ipAddress);

      if (!device) {
        this.log.error('Failed to find device for IP:', ipAddress);
        return null;
      }

      this.log.debug('Device found:', device);
      return {
        ip: device.ip,
        mac: device.mac,
        uuid: this.uuidFactory(device.mac)
      };
    } catch (error) {
      this.log.error('Error finding device by IP address:', error);
      return null;
    }
  }

  public async findByMac(macAddress: string): Promise<NetworkDevice | null> {
    try {
      this.log.info('Locating device by MAC address:', macAddress);
      const devices = await find();
      const device = devices.find(
        (item) => item.mac.toLowerCase() === macAddress.toLowerCase()
      );

      if (!device) {
        this.log.error('Failed to find IP for:', macAddress);
        return null;
      }

      this.log.debug('Device found:', device);
      return {
        ip: device.ip,
        mac: device.mac,
        uuid: this.uuidFactory(device.mac)
      };
    } catch (error) {
      this.log.error('Error finding IP by MAC address:', error);
      return null;
    }
  }
}

export default NetworkDeviceLocator;
