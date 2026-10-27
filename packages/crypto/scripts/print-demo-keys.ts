// Prints the public keys of the seeded demo identities, for services/gateway/config/registry.json.
import { DEMO_IDENTITIES } from '../../schema/src/scenarios';
import { deriveDemoKeyPair } from '../src/index';

const { device, trustedContact } = DEMO_IDENTITIES;
console.log(device.keyId, deriveDemoKeyPair(device.keySeedLabel).publicKey);
console.log(trustedContact.keyId, deriveDemoKeyPair(trustedContact.keySeedLabel).publicKey);
