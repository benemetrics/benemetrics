import { cn } from '../../lib/utils';

export type SparklineColor = 'primary' | 'secondary' | 'error' | 'tertiary';

interface SparklineChartProps {
  data: number[];
  color?: SparklineColor;
  className?: string;
  showArea?: boolean;
  animateEnd?: boolean;
}

const colorMap: Record<SparklineColor, { line: string; area: string }> = {
  primary: { line: '#4cd7f6', area: '#4cd7f6' },
  secondary: { line: '#4edea3', area: '#4edea3' },
  error: { line: '#ffb4ab', area: '#ffb4ab' },
  tertiary: { line: '#c0c1ff', area: '#c0c1ff' },
};

export function SparklineChart({
  data,
  color = 'primary',
  className,
  showArea = false,
  animateEnd = false,
}: SparklineChartProps) {
  if (!data.length) return <div className={cn('w-10 h-5', className)} />;

  const { line, area } = colorMap[color];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 56;
  const height = 20;
  const stepX = width / (data.length - 1 || 1);

  const path = data
    .map((val, i) => {
      const x = i * stepX;
      const y = height - ((val - min) / range) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPath = showArea
    ? `M0 ${height} L${path.slice(2)} L${width} ${height} Z`
    : '';

  return (
    <svg
      className={cn('overflow-visible', className)}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      width="56"
      height="20"
    >
      {showArea && (
        <path
          d={areaPath}
          fill={area}
          fillOpacity={0.2}
        />
      )}
      <path
        d={path}
        stroke={line}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <circle
        cx={width}
        cy={height - ((data[data.length - 1] - min) / range) * (height - 4) - 2}
        fill={line}
        r={2}
        className={animateEnd ? 'animate-ping' : ''}
      />
    </svg>
  );
}