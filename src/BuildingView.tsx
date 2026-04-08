import React from 'react';
import type { Slab, Beam, Column, FrameResult, FlexureResult, ShearResult, BeamOnBeamConnection } from '@/lib/structuralEngine';

interface BuildingViewProps {
  slabs: Slab[];
  beams: Beam[];
  columns: Column[];
  analyzed: boolean;
  frameResults: FrameResult[];
  beamDesigns: {
    beamId: string; frameId: string; Vu: number;
    flexLeft: FlexureResult; flexMid: FlexureResult; flexRight: FlexureResult;
    shear: ShearResult;
  }[];
  colDesigns: { id: string; b: number; h: number; Pu: number; design: any }[];
  onSelectElement?: (type: 'beam' | 'column' | 'slab', id: string) => void;
  storyHeight?: number;
  removedColumnIds?: string[];
  bobConnections?: BeamOnBeamConnection[];
}

function getStressColor(ratio: number): string {
  if (ratio < 0.5) return 'hsl(var(--stress-safe))';
  if (ratio < 0.8) return 'hsl(var(--stress-warn))';
  return 'hsl(var(--stress-danger))';
}

export default function BuildingView({
  slabs, beams, columns, analyzed, beamDesigns, onSelectElement, removedColumnIds = [], bobConnections = []
}: BuildingViewProps) {
  const allX = slabs.flatMap(s => [s.x1, s.x2]);
  const allY = slabs.flatMap(s => [s.y1, s.y2]);
  const minX = Math.min(...allX) - 1;
  const maxX = Math.max(...allX) + 1;
  const minY = Math.min(...allY) - 1;
  const maxY = Math.max(...allY) + 1;

  const scale = 50;
  const padding = 40;
  const width = (maxX - minX) * scale + padding * 2;
  const height = (maxY - minY) * scale + padding * 2;

  const tx = (x: number) => (x - minX) * scale + padding;
  const ty = (y: number) => (y - minY) * scale + padding;

  const beamStressMap = new Map<string, number>();
  if (analyzed) {
    for (const d of beamDesigns) {
      const maxCheck = [d.flexLeft.checkSpacing, d.flexMid.checkSpacing, d.flexRight.checkSpacing];
      const hasTwoLayers = maxCheck.some(c => c !== 'ok');
      beamStressMap.set(d.beamId, hasTwoLayers ? 0.9 : 0.4);
    }
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto max-h-[60vh] md:max-h-[70vh]">
      {/* Grid lines */}
      {[...new Set(slabs.flatMap(s => [s.x1, s.x2]))].sort((a, b) => a - b).map(x => (
        <line key={`gx${x}`} x1={tx(x)} y1={padding / 2} x2={tx(x)} y2={height - padding / 2}
          stroke="hsl(var(--canvas-grid))" strokeWidth="0.5" strokeDasharray="4" />
      ))}
      {[...new Set(slabs.flatMap(s => [s.y1, s.y2]))].sort((a, b) => a - b).map(y => (
        <line key={`gy${y}`} x1={padding / 2} y1={ty(y)} x2={width - padding / 2} y2={ty(y)}
          stroke="hsl(var(--canvas-grid))" strokeWidth="0.5" strokeDasharray="4" />
      ))}

      {/* Slabs */}
      {slabs.map(s => (
        <g key={s.id} className="cursor-pointer" onClick={() => onSelectElement?.('slab', s.id)}>
          <rect x={tx(s.x1)} y={ty(s.y1)} width={(s.x2 - s.x1) * scale} height={(s.y2 - s.y1) * scale}
            fill="hsl(var(--slab-fill) / 0.08)" stroke="hsl(var(--slab))" strokeWidth="0.5" />
          <text x={tx((s.x1 + s.x2) / 2)} y={ty((s.y1 + s.y2) / 2)} textAnchor="middle" dominantBaseline="middle"
            className="fill-muted-foreground" fontSize="10" fontFamily="JetBrains Mono">{s.id}</text>
        </g>
      ))}

      {/* Beams */}
      {beams.map(b => {
        const stress = beamStressMap.get(b.id) || 0;
        const color = analyzed ? getStressColor(stress) : 'hsl(var(--beam))';
        return (
          <g key={b.id} className="cursor-pointer" onClick={() => onSelectElement?.('beam', b.id)}>
            <line x1={tx(b.x1)} y1={ty(b.y1)} x2={tx(b.x2)} y2={ty(b.y2)} stroke={color} strokeWidth="3" />
            <text x={tx((b.x1 + b.x2) / 2)} y={ty((b.y1 + b.y2) / 2) - 6} textAnchor="middle"
              className="fill-foreground" fontSize="8" fontFamily="JetBrains Mono">{b.id}</text>
          </g>
        );
      })}

      {/* Columns */}
      {columns.map(c => {
        const isRemoved = removedColumnIds.includes(c.id);
        return (
          <g key={c.id} className="cursor-pointer" onClick={() => onSelectElement?.(isRemoved ? 'beam' : 'column', c.id)}>
            {isRemoved ? (
              <>
                <circle cx={tx(c.x)} cy={ty(c.y)} r="6" fill="none" stroke="hsl(var(--destructive))" strokeWidth="1.5" />
                <text x={tx(c.x)} y={ty(c.y) + 3} textAnchor="middle" fontSize="8" fill="hsl(var(--destructive))">×</text>
              </>
            ) : (
              <rect x={tx(c.x) - 5} y={ty(c.y) - 5} width="10" height="10" fill="hsl(var(--column))" rx="1" />
            )}
            <text x={tx(c.x)} y={ty(c.y) + 16} textAnchor="middle"
              className="fill-foreground" fontSize="7" fontFamily="JetBrains Mono">{c.id}</text>
          </g>
        );
      })}

      {/* Beam-on-Beam load path arrows */}
      {bobConnections.map((conn, i) => {
        const px = tx(conn.point.x);
        const py = ty(conn.point.y);
        return (
          <text key={`bob${i}`} x={px} y={py - 10} textAnchor="middle" fontSize="14" fill="hsl(var(--accent))">⇊</text>
        );
      })}

      {/* Axis labels */}
      {[...new Set(slabs.flatMap(s => [s.x1, s.x2]))].sort((a, b) => a - b).map(x => (
        <text key={`lx${x}`} x={tx(x)} y={height - 5} textAnchor="middle" fontSize="9"
          className="fill-muted-foreground" fontFamily="JetBrains Mono">{x}m</text>
      ))}
      {[...new Set(slabs.flatMap(s => [s.y1, s.y2]))].sort((a, b) => a - b).map(y => (
        <text key={`ly${y}`} x={10} y={ty(y) + 3} fontSize="9"
          className="fill-muted-foreground" fontFamily="JetBrains Mono">{y}m</text>
      ))}

      {/* Legend */}
      {analyzed && (
        <g transform={`translate(${width - 120}, ${height - 30})`}>
          <rect x="0" y="0" width="8" height="8" fill="hsl(var(--stress-safe))" />
          <text x="12" y="7" fontSize="7" className="fill-foreground">آمن</text>
          <rect x="35" y="0" width="8" height="8" fill="hsl(var(--stress-warn))" />
          <text x="47" y="7" fontSize="7" className="fill-foreground">تحذير</text>
          <rect x="70" y="0" width="8" height="8" fill="hsl(var(--stress-danger))" />
          <text x="82" y="7" fontSize="7" className="fill-foreground">خطر</text>
        </g>
      )}
    </svg>
  );
}
