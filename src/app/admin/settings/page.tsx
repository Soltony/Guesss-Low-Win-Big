import { PageHeader } from '@/components/admin/page-header';
import { SettingsForm } from '@/components/admin/settings-form';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { CATEGORY_LABELS, SETTING_DEFINITIONS, getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const [user, values] = await Promise.all([
    getCurrentUser({ allowRefresh: false }),
    getSettings(true),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Platform-wide configuration. Auction-level values override these defaults."
      />
      <SettingsForm
        definitions={SETTING_DEFINITIONS}
        categoryLabels={CATEGORY_LABELS}
        values={values}
        canUpdate={hasPermission(user, 'settings', 'update')}
      />
    </>
  );
}
