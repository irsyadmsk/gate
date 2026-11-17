import { useEffect, useState } from 'react';
import { supabase } from '@irsyads/supabase/klien';
import { urlMasukId } from '@irsyads/supabase/auth';
import { nativeBoardingService } from '../../lib/boarding-native';
import { loginErrorMessage, lupaSandiUrl } from '../../lib/login-form';
import GateConsole from './GateConsole';
import LoginScreen from './LoginScreen';

async function signIn(email: string, password: string, captchaToken: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
  return error ? { message: loginErrorMessage(error) } : null;
}

/** Web: sesi memakai cookie *.irsyads.com yang sama dengan id.irsyads.com, jadi masuk di sini berlaku juga di sana dan sebaliknya. */
export default function NativeGateRoot({ onDemo }: { onDemo?: (actorId: string) => void }) {
  const [sessionId, setSessionId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true, revision = 0;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { revision++; if (live) setSessionId(session?.user.id ?? null); });
    const ticket = revision;
    supabase.auth.getSession().then(({ data, error }) => { if (live && ticket === revision) setSessionId(!error ? data.session?.user.id ?? null : null); });
    return () => { live = false; data.subscription.unsubscribe(); };
  }, []);
  if (sessionId) return <GateConsole key={sessionId} service={nativeBoardingService} signedOut={() => setSessionId(null)} />;
  return <LoginScreen checking={sessionId === undefined} signIn={signIn} idLoginUrl={urlMasukId(window.location.href, 'id')}
    recoveryUrl={lupaSandiUrl(window.location.origin + '/', import.meta.env.DEV)} guestHref="/tamu" onDemo={onDemo} privacyHref="/privasi" />;
}
