'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface Point {
  date: string;
  bids: number;
  revenue: number;
}

const formatDay = (value: string) => {
  const date = new Date(value);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

export function ActivityChart({
  data,
  showRevenue,
}: {
  data: Point[];
  showRevenue: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">Bidding activity</h2>
        <p className="text-xs text-muted-foreground">
          Confirmed bids{showRevenue ? ' and service-fee revenue' : ''}, last {data.length} days
        </p>
      </div>

      <div className="h-72 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="bidsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.35} />
                <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDay}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              labelFormatter={formatDay}
              contentStyle={{
                background: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(value: number, name) =>
                name === 'revenue'
                  ? [`${Number(value).toFixed(2)} Br`, 'Fee revenue']
                  : [value, 'Bids']
              }
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) => (value === 'revenue' ? 'Fee revenue' : 'Bids')}
            />

            <Area
              type="monotone"
              dataKey="bids"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              fill="url(#bidsFill)"
            />
            {showRevenue && (
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--chart-2))"
                strokeWidth={2}
                fill="url(#revenueFill)"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
