/**
 * مقارنة نتائج التحليل بين الطريقة 2D (Matrix Stiffness — إطارات مستوية) و 3D (6-DOF Frame Solver)
 * القيم مأخوذة مباشرةً من نتائج التحليل المحسوبة في التطبيق — لا إعادة حساب.
 *
 * 3D = getFrameResults3D  ← solver3D.ts (6 DOF/عقدة + Pattern Loading + ACI 318-19 modifiers)
 * 2D = analyzeFrame       ← matrixStiffness.ts (2 DOF/عقدة + Pattern Loading, EI كاملة)
 */

import React, { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type {
  Beam, Column, Frame, FrameResult, Story,
} from '@/lib/structuralEngine';

interface ColLoad {
  Pu: number;
  Mx: number;
  My: number;
  MxTop?: number;
  MxBot?: number;
  MyTop?: number;
  MyBot?: number;
}

interface Props {
  frames: Frame[];
  beams: Beam[];
  columns: Column[];
  stories: Story[];
  /** نتائج التحليل 3D — المصدر الأساسي للتطبيق (getFrameResults3D) */
  frameResults3D: FrameResult[];
  /** نتائج التحليل 2D — (analyzeFrame / matrixStiffness) */
  frameResults2D: FrameResult[];
  /** أحمال الأعمدة من التحليل 3D */
  colLoads3D: Map<string, ColLoad>;
  /** أحمال الأعمدة من التحليل 2D */
  colLoads2D: Map<string, ColLoad>;
}

interface BeamCompRow {
  beamId: string;
  frameId: string;
  storyLabel: string;
  span: number;
  m2d_left: number; m2d_mid: number; m2d_right: number; v2d: number;
  m3d_left: number; m3d_mid: number; m3d_right: number; v3d: number;
}

interface ColCompRow {
  colId: string;
  bxh: string;
  storyLabel: string;
  pu2d: number; mx2d: number; my2d: number;
  pu3d: number; mx3d: number; my3d: number;
}

const ETABSComparisonTable: React.FC<Props> = ({
  frames, beams, columns, stories,
  frameResults3D, frameResults2D,
  colLoads3D, colLoads2D,
}) => {
  const beamsMap = useMemo(() => new Map(beams.map(b => [b.id, b])), [beams]);

  // ── بناء خريطة نتائج 2D و 3D بالـ beamId ──────────────────────────────
  const beam3DMap = useMemo(() => {
    const map = new Map<string, FrameResult['beams'][number] & { frameId: string }>();
    for (const fr of frameResults3D) {
      for (const br of fr.beams) {
        map.set(br.beamId, { ...br, frameId: fr.frameId });
      }
    }
    return map;
  }, [frameResults3D]);

  const beam2DMap = useMemo(() => {
    const map = new Map<string, FrameResult['beams'][number]>();
    for (const fr of frameResults2D) {
      for (const br of fr.beams) {
        map.set(br.beamId, br);
      }
    }
    return map;
  }, [frameResults2D]);

  // ── صفوف مقارنة الجسور ─────────────────────────────────────────────────
  const beamRows = useMemo<BeamCompRow[]>(() => {
    const rows: BeamCompRow[] = [];
    for (const frame of frames) {
      for (const beamId of frame.beamIds) {
        const beam = beamsMap.get(beamId);
        if (!beam) continue;
        const r3 = beam3DMap.get(beamId);
        const r2 = beam2DMap.get(beamId);
        const storyLabel = stories.find(s => s.id === beam.storyId)?.label ?? '';
        rows.push({
          beamId,
          frameId: frame.id,
          storyLabel,
          span: r3?.span ?? r2?.span ?? beam.length,
          m2d_left:  r2?.Mleft  ?? 0,
          m2d_mid:   r2?.Mmid   ?? 0,
          m2d_right: r2?.Mright ?? 0,
          v2d:       r2?.Vu     ?? 0,
          m3d_left:  r3?.Mleft  ?? 0,
          m3d_mid:   r3?.Mmid   ?? 0,
          m3d_right: r3?.Mright ?? 0,
          v3d:       r3?.Vu     ?? 0,
        });
      }
    }
    return rows;
  }, [frames, beamsMap, beam3DMap, beam2DMap, stories]);

  // ── صفوف مقارنة الأعمدة ────────────────────────────────────────────────
  const colRows = useMemo<ColCompRow[]>(() => {
    return columns
      .filter(c => !c.isRemoved)
      .map(c => {
        const l3 = colLoads3D.get(c.id);
        const l2 = colLoads2D.get(c.id);
        const storyLabel = stories.find(s => s.id === c.storyId)?.label ?? '';
        return {
          colId: c.id,
          bxh: `${c.b}×${c.h}`,
          storyLabel,
          pu2d: l2?.Pu ?? 0,
          mx2d: l2?.Mx ?? 0,
          my2d: l2?.My ?? 0,
          pu3d: l3?.Pu ?? 0,
          mx3d: l3?.Mx ?? 0,
          my3d: l3?.My ?? 0,
        };
      });
  }, [columns, colLoads3D, colLoads2D, stories]);

  // ── أدوات مقارنة ───────────────────────────────────────────────────────
  const diffPct = (a: number, b: number): string => {
    if (Math.abs(a) < 0.01 && Math.abs(b) < 0.01) return '—';
    const base = Math.max(Math.abs(a), Math.abs(b));
    return ((Math.abs(Math.abs(b) - Math.abs(a)) / base) * 100).toFixed(1) + '%';
  };

  const diffColor = (a: number, b: number): string | undefined => {
    if (Math.abs(a) < 0.01 && Math.abs(b) < 0.01) return undefined;
    const base = Math.max(Math.abs(a), Math.abs(b));
    const pct = base > 0.01 ? (Math.abs(Math.abs(b) - Math.abs(a)) / base) * 100 : 0;
    if (pct < 5)  return 'hsl(142 71% 45%)';   // أخضر — فرق مقبول
    if (pct < 15) return 'hsl(45 93% 47%)';    // أصفر — فرق متوسط
    return 'hsl(0 84.2% 60.2%)';               // أحمر — فرق كبير
  };

  if (beamRows.length === 0 && colRows.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* وصف المنهجية */}
      <Card>
        <CardContent className="py-3 space-y-1">
          <p className="text-xs font-medium">منهجية المقارنة</p>
          <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground">
            <span>
              <span className="font-semibold text-blue-500">2D</span>
              {' '}= Matrix Stiffness Method (إطارات مستوية · 2 DOF/عقدة · EI كاملة · Pattern Loading)
            </span>
            <span>
              <span className="font-semibold text-emerald-500">3D</span>
              {' '}= Direct Stiffness 3D (6 DOF/عقدة · معاملات ACI 318-19 §6.6.3 · Pattern Loading §6.4.3)
            </span>
          </div>
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            ⚠️ الفرق المتوقع بين 2D و 3D يعود لـ: (1) معاملات الجساءة ACI في 3D (0.35Ig جسور · 0.65Ig أعمدة — للتفاعل الكامل بين الإطارات)
            و (2) التفاعل الكامل بين الإطارات في التحليل 3D.
            القيم المعتمدة في التصميم هي قيم <span className="font-semibold">3D</span>.
          </p>
        </CardContent>
      </Card>

      {/* جدول مقارنة الجسور */}
      {beamRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              مقارنة القوى الداخلية للجسور
              <Badge variant="outline" className="text-[10px]">2D مقابل 3D</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">الدور</TableHead>
                  <TableHead className="text-xs">الإطار</TableHead>
                  <TableHead className="text-xs">الجسر</TableHead>
                  <TableHead className="text-xs">البحر (م)</TableHead>
                  <TableHead className="text-[10px] text-center" colSpan={3}>M يسار (kN·m)</TableHead>
                  <TableHead className="text-[10px] text-center" colSpan={3}>M منتصف (kN·m)</TableHead>
                  <TableHead className="text-[10px] text-center" colSpan={3}>M يمين (kN·m)</TableHead>
                  <TableHead className="text-[10px] text-center" colSpan={3}>Vu (kN)</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead /><TableHead /><TableHead /><TableHead />
                  {['2D','3D','Δ%','2D','3D','Δ%','2D','3D','Δ%','2D','3D','Δ%'].map((h, i) => (
                    <TableHead key={i} className="text-[10px] text-center px-1">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {beamRows.map(r => (
                  <TableRow key={`${r.frameId}-${r.beamId}`}>
                    <TableCell className="text-xs text-muted-foreground">{r.storyLabel}</TableCell>
                    <TableCell className="font-mono text-xs">{r.frameId}</TableCell>
                    <TableCell className="font-mono text-xs font-bold">{r.beamId}</TableCell>
                    <TableCell className="font-mono text-xs">{r.span.toFixed(2)}</TableCell>
                    {/* M يسار */}
                    <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{r.m2d_left.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{r.m3d_left.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(r.m2d_left, r.m3d_left) }}>{diffPct(r.m2d_left, r.m3d_left)}</TableCell>
                    {/* M منتصف */}
                    <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{r.m2d_mid.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{r.m3d_mid.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(r.m2d_mid, r.m3d_mid) }}>{diffPct(r.m2d_mid, r.m3d_mid)}</TableCell>
                    {/* M يمين */}
                    <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{r.m2d_right.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{r.m3d_right.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(r.m2d_right, r.m3d_right) }}>{diffPct(r.m2d_right, r.m3d_right)}</TableCell>
                    {/* Vu */}
                    <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{r.v2d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{r.v3d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(r.v2d, r.v3d) }}>{diffPct(r.v2d, r.v3d)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* جدول مقارنة الأعمدة */}
      {colRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              مقارنة القوى الداخلية للأعمدة
              <Badge variant="outline" className="text-[10px]">2D مقابل 3D</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              2D = توزيع العزوم بنسبة الجساءة (من ردود أفعال الجسور) ·
              3D = تحليل مباشر بالإطار الفراغي
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">الدور</TableHead>
                  <TableHead className="text-xs">العمود</TableHead>
                  <TableHead className="text-xs">المقطع</TableHead>
                  <TableHead className="text-[10px] text-center" colSpan={3}>Pu (kN)</TableHead>
                  <TableHead className="text-[10px] text-center" colSpan={3}>Mx (kN·m)</TableHead>
                  <TableHead className="text-[10px] text-center" colSpan={3}>My (kN·m)</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead /><TableHead /><TableHead />
                  {['2D','3D','Δ%','2D','3D','Δ%','2D','3D','Δ%'].map((h, i) => (
                    <TableHead key={i} className="text-[10px] text-center px-1">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {colRows.map(r => (
                  <TableRow key={r.colId}>
                    <TableCell className="text-xs text-muted-foreground">{r.storyLabel}</TableCell>
                    <TableCell className="font-mono text-xs font-bold">{r.colId}</TableCell>
                    <TableCell className="font-mono text-xs">{r.bxh}</TableCell>
                    {/* Pu */}
                    <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{r.pu2d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{r.pu3d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(r.pu2d, r.pu3d) }}>{diffPct(r.pu2d, r.pu3d)}</TableCell>
                    {/* Mx */}
                    <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{r.mx2d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{r.mx3d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(r.mx2d, r.mx3d) }}>{diffPct(r.mx2d, r.mx3d)}</TableCell>
                    {/* My */}
                    <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{r.my2d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{r.my3d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(r.my2d, r.my3d) }}>{diffPct(r.my2d, r.my3d)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* مفتاح الألوان */}
      <Card>
        <CardContent className="py-2">
          <div className="flex gap-5 text-[10px] flex-wrap">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block bg-blue-500 opacity-70" />
              قيم 2D (Matrix Stiffness)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block bg-emerald-500 opacity-70" />
              قيم 3D (المعتمدة في التصميم)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: 'hsl(142 71% 45%)' }} />
              Δ &lt; 5% — فرق مقبول
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: 'hsl(45 93% 47%)' }} />
              Δ 5–15% — فرق متوسط
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: 'hsl(0 84.2% 60.2%)' }} />
              Δ &gt; 15% — فرق كبير
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ETABSComparisonTable;
