'use client';

// =============================================================================
// CommunityStatCards — four read-only stat cards (city, price, qmi count, fp count).
// =============================================================================

import { Card, CardContent } from '@/components/ui/card';
import { MapPin, DollarSign, Home, LayoutTemplate } from 'lucide-react';
import type { CommunityDetailView } from '../../../lib/community-detail';

type Stats = CommunityDetailView['stats'];

export function CommunityStatCards({ stats }: { stats: Stats }) {
  const cards = [
    { icon: MapPin, label: 'City', value: stats.city || '—' },
    { icon: DollarSign, label: 'Starting Price', value: stats.startingPrice || '—' },
    { icon: Home, label: 'Quick Move-Ins', value: String(stats.qmiCount) },
    { icon: LayoutTemplate, label: 'Floor Plans', value: String(stats.floorPlanCount) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="py-4">
          <CardContent className="px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <card.icon className="size-3.5" />
              <span className="text-xs">{card.label}</span>
            </div>
            <p className="text-xl font-semibold">{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
