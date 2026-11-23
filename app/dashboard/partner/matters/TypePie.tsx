'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export default function TypePie({ data, total }: { data: { name: string; value: number; color: string }[]; total: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={2}
          stroke="var(--card-bg)"
          strokeWidth={2}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value, name) => {
            const n = typeof value === 'number' ? value : Number(value);
            return [`${n} (${total ? ((n / total) * 100).toFixed(0) : 0}%)`, name];
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
