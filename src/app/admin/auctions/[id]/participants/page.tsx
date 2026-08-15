import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/admin/page-header';
import { ParticipantManager } from '@/components/admin/participant-manager';
import { StatusBadge } from '@/components/admin/status-badge';
import { getCurrentUser } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { isRestricted } from '@/lib/eligibility';
import { listSummaries } from '@/lib/participant-lists';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auction = await prisma.auction.findUnique({
    where: { id },
    select: { code: true },
  });
  return { title: auction ? `Participants · #${auction.code}` : 'Participants' };
}

export default async function AuctionParticipantsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [auction, user, savedLists] = await Promise.all([
    prisma.auction.findUnique({
      where: { id },
      select: { id: true, code: true, title: true, status: true, eligibilityMode: true },
    }),
    getCurrentUser({ allowRefresh: false }),
    listSummaries({ activeOnly: true }),
  ]);

  if (!auction) notFound();

  return (
    <>
      <PageHeader
        title="Eligible participants"
        breadcrumbs={[
          { label: 'Auctions', href: '/admin/auctions' },
          { label: `#${auction.code}`, href: `/admin/auctions/${auction.id}` },
          { label: 'Participants' },
        ]}
        description={`Who may bid on ${auction.title}.`}
        actions={<StatusBadge status={auction.status} />}
      />

      <ParticipantManager
        auction={{
          id: auction.id,
          code: auction.code,
          title: auction.title,
          status: auction.status,
          restricted: isRestricted(auction),
        }}
        savedLists={savedLists.map((list) => ({
          id: list.id,
          name: list.name,
          entryCount: list.entryCount,
        }))}
        canUpdate={hasPermission(user, 'auctions', 'update')}
      />
    </>
  );
}
