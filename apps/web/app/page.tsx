import Workspace from './workspace';
import AuthGate from './auth-gate';
export default function Page() {
  return (
    <AuthGate>
      <Workspace />
    </AuthGate>
  );
}
