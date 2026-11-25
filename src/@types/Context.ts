import TPLink from '../api/TPLink';

interface Context {
  name: string;
  tpLink: TPLink;
  child: false;
  deviceId?: string;
  model?: string;
  deviceType?: string;
}

export default Context;
