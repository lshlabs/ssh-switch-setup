import { LoaderCircle } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { useAppCopy } from '../i18n';

const LATENCY_WINDOW_SIZE = 30;

export default function LatencySparkline({ values }: { values: number[] }) {
  const { t } = useAppCopy();
  const recentValues = values.slice(-LATENCY_WINDOW_SIZE);
  const emptyCount = LATENCY_WINDOW_SIZE - recentValues.length;
  const data = Array.from({ length: LATENCY_WINDOW_SIZE }, (_, slot) => {
    const valueIndex = slot - emptyCount;

    return {
      slot,
      latency: valueIndex >= 0 ? recentValues[valueIndex] : null,
    };
  });
  const max = Math.max(30, ...recentValues);

  return (
    <div
      className="home-latency-chart"
      role="img"
      aria-label={
        values.length
          ? t('home.onlineLatencyTrend', { count: values.length })
          : t('home.latencyAfterCheck')
      }
    >
      {values.length ? (
        <ResponsiveContainer className="home-latency-chart-inner">
          <AreaChart
            accessibilityLayer={false}
            data={data}
            margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              vertical
              horizontal
              verticalCoordinatesGenerator={({ offset }) =>
                Array.from(
                  { length: 5 },
                  (_, index) => offset.left + (offset.width * (index + 1)) / 6,
                )
              }
              stroke="var(--app-border)"
              strokeDasharray="1 5"
              strokeLinecap="round"
              strokeOpacity={0.48}
            />

            <YAxis
              axisLine={false}
              allowDecimals={false}
              domain={[0, max]}
              tick={{ fill: 'var(--app-muted)', fontSize: 10 }}
              tickLine={false}
              ticks={[0, Math.round(max / 2), max]}
              width={26}
            />

            <XAxis dataKey="slot" hide />

            <Area
              activeDot={false}
              baseValue={0}
              dataKey="latency"
              fill="var(--app-primary)"
              fillOpacity={0.14}
              isAnimationActive={false}
              stroke="var(--app-primary)"
              strokeWidth={2.2}
              type="monotone"
              dot={false}
              connectNulls={false}
            />
            <ReferenceLine y={0} stroke="var(--app-border)" strokeWidth={1} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <span className="home-latency-empty" aria-hidden="true">
          <LoaderCircle className="home-latency-loader" size={24} strokeWidth={2.25} />
        </span>
      )}
    </div>
  );
}
