import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Dropdown, Form, Input, Modal, Spin, Typography } from 'antd';
import { ArrowRight, Boxes, KeyRound, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { api, jsonRequest, setCsrfToken } from '../api';

type Session = { authenticated: boolean; required: boolean; setupRequired: boolean; username: string | null; csrfToken?: string };
type AuthContext = { session: Session; update: (session: Session) => void };
const AccountContext = createContext<AuthContext | null>(null);
const { Title, Text, Paragraph } = Typography;
export function LocalAccountBoundary({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const update = (next: Session) => { setCsrfToken(next.csrfToken); setSession(next); };
  const refresh = () => {
    setError('');
    void api<Session>('/api/auth/session').then(update).catch(e => setError(e.message));
  };
  useEffect(() => {
    refresh();
    const expired = () => { setCsrfToken(undefined); setSession(current => current ? { ...current, authenticated: false } : null); };
    window.addEventListener('smartwall-session-expired', expired);
    return () => window.removeEventListener('smartwall-session-expired', expired);
  }, []);
  if (!session) return <div className="local-auth-loading">{error ? <><Alert type="error" title="Could not connect to this wall" description={error} /><Button onClick={refresh}>Try again</Button></> : <Spin size="large" aria-label="Checking your session" />}</div>;
  return <AccountContext.Provider value={{ session, update }}>{session.authenticated ? children : <LoginScreen session={session} onSignedIn={update} />}</AccountContext.Provider>;
}

function PasswordFields() {
  return <>
    <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter a password' }, { min: 12, message: 'Use at least 12 characters' }, { max: 256 }]} extra="Use at least 12 characters. A memorable passphrase works well.">
      <Input.Password autoComplete="new-password" maxLength={256} size="large" />
    </Form.Item>
    <Form.Item name="confirmPassword" label="Confirm password" dependencies={['password']} rules={[{ required: true, message: 'Confirm your password' }, ({ getFieldValue }) => ({ validator: (_, value) => !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('The passwords do not match')) })]}>
      <Input.Password autoComplete="new-password" maxLength={256} size="large" />
    </Form.Item>
  </>;
}
function UsernameField() {
  return <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Enter your username' }, { pattern: /^[a-zA-Z0-9][a-zA-Z0-9._@-]{2,63}$/, message: 'Use 3–64 letters, numbers, dots, dashes or @' }]}>
    <Input autoComplete="username" maxLength={64} size="large" prefix={<UserRound size={18} />} />
  </Form.Item>;
}
function LoginScreen({ session, onSignedIn }: { session: Session; onSignedIn: (session: Session) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setupRequired, setSetupRequired] = useState(session.setupRequired);
  const submit = async (values: Record<string, string>) => {
    setBusy(true); setError('');
    try { onSignedIn(await api<Session>('/api/auth/' + (setupRequired ? 'setup' : 'login'), jsonRequest('POST', values))); }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in');
      // Another browser may have completed setup while this page was open.
      try { setSetupRequired((await api<Session>('/api/auth/session')).setupRequired); } catch { /* retain message */ }
    } finally { setBusy(false); }
  };
  return <main className="local-auth-page">
    <section className="local-auth-story" aria-label="About SmartWall">
      <div className="local-auth-brand"><span><Boxes size={29} /></span>SmartWall</div>
      <div className="local-auth-story-copy"><div className="local-auth-eyebrow">YOUR WORKSHOP, CONNECTED</div><h1>Everything in<br />its place.</h1><p>Find the right component. Know what’s in stock.<br />Keep your workshop moving.</p></div>
      <div className="local-auth-local"><ShieldCheck size={20} /><span>Your inventory and account stay on this wall.</span></div>
    </section>
    <section className="local-auth-form-panel">
      <div className="local-auth-form-wrap">
        <div className="local-auth-icon"><KeyRound size={24} /></div>
        <Title level={2}>{setupRequired ? 'Make this wall yours' : 'Welcome back'}</Title>
        <Paragraph type="secondary">{setupRequired ? 'Create your local administrator account to get started.' : 'Sign in to manage your workshop’s inventory.'}</Paragraph>
        {error && <Alert type="error" title={error} showIcon className="local-auth-error" />}
        <Form layout="vertical" onFinish={submit} requiredMark={false} key={String(setupRequired)}>
          {setupRequired && <Form.Item name="setupCode" label="Setup code" extra="Use the code saved by the installer in runtime/secrets/admin_password. You only need it for initial setup." rules={[{ required: true, message: 'Enter the installer’s setup code' }]}><Input.Password autoComplete="off" size="large" /></Form.Item>}
          <UsernameField />
          {setupRequired ? <PasswordFields /> : <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}><Input.Password autoComplete="current-password" maxLength={256} size="large" /></Form.Item>}
          <Button type="primary" htmlType="submit" block size="large" loading={busy} icon={<ArrowRight size={18} />} iconPlacement="end">{setupRequired ? 'Create account' : 'Sign in'}</Button>
        </Form>
        <div className="local-auth-footer">Local access to this SmartWall. Your SmartWall Online account is separate.</div>
      </div>
      <span className="local-auth-maker">SmartWall by E-Nano</span>
    </section>
  </main>;
}

export function LocalAccountMenu() {
  const account = useContext(AccountContext);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  if (!account?.session.required) return null;
  const logout = async () => {
    try { await api('/api/auth/logout', jsonRequest('POST', {})); account.update({ ...account.session, authenticated: false, csrfToken: undefined }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not sign out'); setOpen(true); }
  };
  const save = async (values: Record<string, string>) => {
    setBusy(true); setError('');
    try {
      account.update(await api<Session>('/api/auth/account', jsonRequest('POST', values)));
      setOpen(false); form.resetFields();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update your account'); }
    finally { setBusy(false); }
  };
  return <>
    <Dropdown menu={{ items: [{ key: 'account', label: 'Account settings', icon: <KeyRound size={16} /> }, { key: 'logout', label: 'Sign out', icon: <LogOut size={16} /> }], onClick: ({ key }) => { if (key === 'logout') void logout(); else { setError(''); form.resetFields(); setOpen(true); } } }} trigger={['click']}>
      <Button size="large" icon={<UserRound size={20} />} aria-label={`Account: ${account.session.username}`}>{account.session.username}</Button>
    </Dropdown>
    <Modal title="Your local account" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
      <Paragraph type="secondary">Update your username and password. Other signed-in sessions will be signed out.</Paragraph>
      {error && <Alert type="error" title={error} showIcon className="local-auth-error" />}
      <Form form={form} layout="vertical" initialValues={{ username: account.session.username }} onFinish={save} requiredMark={false}>
        <UsernameField />
        <Form.Item name="currentPassword" label="Current password" rules={[{ required: true, message: 'Enter your current password' }]}><Input.Password autoComplete="current-password" maxLength={256} /></Form.Item>
        <PasswordFields />
        <Button type="primary" htmlType="submit" block loading={busy}>Save account</Button>
      </Form>
    </Modal>
  </>;
}
