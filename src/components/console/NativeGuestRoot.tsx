import GuestRegistration from './GuestRegistration';
import { nativeGuestService } from '../../lib/boarding-native';
import '../../styles/console.css';
export default function NativeGuestRoot() { return <GuestRegistration service={nativeGuestService} />; }
