import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isGuardFailure, requirePermission } from '@/lib/api';
import { createAuditLog } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 20_000;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  // Prefix formula-leading characters so spreadsheets treat them as text.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission('audit-logs', 'read');
  if (isGuardFailure(guard)) return guard.response;
  const { user } = guard;

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const where: any = {};
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
    };
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS,
  });

  const header = [
    'Timestamp',
    'Actor Id',
    'Actor Name',
    'Actor Type',
    'Action',
    'Entity',
    'Entity Id',
    'IP Address',
    'Correlation Id',
    'Details',
  ];

  const rows = logs.map((log) =>
    [
      log.createdAt.toISOString(),
      log.actorId,
      log.actorName,
      log.actorType,
      log.action,
      log.entity,
      log.entityId,
      log.ipAddress,
      log.correlationId,
      log.details,
    ]
      .map(csvCell)
      .join(',')
  );

  const csv = [header.map(csvCell).join(','), ...rows].join('\r\n');

  await createAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'AUDIT_LOG_EXPORTED',
    entity: 'AuditLog',
    details: { rows: logs.length, from, to, truncated: logs.length === MAX_ROWS },
  });

  const filename = `guesslow-audit-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
