/**
 * 業種別の配当内訳。
 *
 * 月別の偏り（3 月に 49% 集中）は既に見えているが、業種の偏りは
 * 見えていなかった。配当の何割がどの産業から来ているかが分かれば、
 * 金利が下がる局面で金融の配当がどれだけ削られるか、
 * 次に買う銘柄をどの業種から選ぶべきかを判断できる。
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Briefcase } from "lucide-react";
import { sectorLabelJa, UNCLASSIFIED_SECTOR } from "@shared/sectorLabels";
import { useState } from "react";

type SectorRow = {
  sector: string;
  annualIncomeBase: number;
  sharePct: number;
  marketValueBase: number;
  yieldPct: number | null;
  symbolCount: number;
};

/** 業種の銘柄を出すために使う、銘柄ビューと同じ行の形 */
type StockRow = {
  symbol: string;
  name: string;
  sector: string | null;
  annualBase: number;
  yieldPct: number | null;
};

export function SectorDividendView({
  sectors,
  topSector,
  topSectorSharePct,
  stockRows,
  money,
}: {
  sectors: SectorRow[];
  topSector: string | null;
  topSectorSharePct: number | null;
  stockRows: StockRow[];
  money: (baseJpy: number | null | undefined) => string;
}) {
  const [openSector, setOpenSector] = useState<string | null>(null);

  if (sectors.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          配当のある銘柄がまだありません
        </CardContent>
      </Card>
    );
  }

  /*
   * 帯の長さは最大の業種を 100% として相対で描く。
   * 占有率そのものを幅にすると、最大が 17.8% のときに
   * どの帯も短くなって差が読み取れない。
   */
  const maxShare = Math.max(...sectors.map(s => s.sharePct));

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <Briefcase className="h-4 w-4" />
            業種別の配当
          </CardTitle>
          <CardDescription className="text-xs">
            どの産業から配当が来ているか。業種をタップすると銘柄が出ます。
            無配の銘柄は含めていません（利回りが実際より低く見えるため）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {sectors.map(s => {
            const isOpen = openSector === s.sector;
            const rows = stockRows
              .filter(r => {
                const sec = r.sector?.trim() ? r.sector.trim() : UNCLASSIFIED_SECTOR;
                return sec === s.sector && r.annualBase > 0;
              })
              .sort((a, b) => b.annualBase - a.annualBase);
            return (
              <div key={s.sector}>
                <button
                  type="button"
                  onClick={() => setOpenSector(isOpen ? null : s.sector)}
                  aria-expanded={isOpen}
                  className="w-full rounded-md px-1.5 py-2 text-left transition-all duration-150 hover:bg-accent/50 active:scale-[0.99]"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {sectorLabelJa(s.sector)}
                    </span>
                    <span className="tabular shrink-0 text-sm font-semibold">
                      {s.sharePct.toFixed(1)}%
                    </span>
                  </div>
                  {/* 帯。最大の業種を基準にした相対の長さ */}
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${(s.sharePct / maxShare) * 100}%` }}
                    />
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="tabular">
                      {money(s.annualIncomeBase)} / {s.symbolCount} 銘柄
                    </span>
                    <span className="tabular">
                      利回り {s.yieldPct !== null ? `${s.yieldPct.toFixed(2)}%` : "—"}
                    </span>
                  </div>
                </button>

                {isOpen ? (
                  <div className="mb-1 ml-1.5 space-y-0.5 border-l pl-2.5">
                    {rows.map(r => (
                      <Link
                        key={r.symbol}
                        href={`/holdings?symbol=${encodeURIComponent(r.symbol)}`}
                        className="flex items-baseline justify-between gap-2 rounded px-1 py-1 transition-colors hover:bg-accent/50"
                      >
                        <span className="truncate text-xs">{r.name}</span>
                        <span className="tabular shrink-0 text-xs text-muted-foreground">
                          {money(r.annualBase)}
                          {r.yieldPct !== null ? (
                            <span className="ml-1.5 border-l pl-1.5">
                              {r.yieldPct.toFixed(2)}%
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    ))}
                    {rows.length === 0 ? (
                      <p className="px-1 py-1 text-[11px] text-muted-foreground">
                        絞り込み条件に一致する銘柄がありません
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/*
        依存度の説明。
        「金融 17.8%」という数字だけでは、それが偏っているのか
        分散しているのか判断できないため、目安を添える。
      */}
      {topSector !== null && topSectorSharePct !== null ? (
        <Card>
          <CardContent className="p-4 text-xs leading-relaxed">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-muted-foreground">最も配当が多い業種</span>
              <span className="tabular font-semibold">
                {sectorLabelJa(topSector)} {topSectorSharePct.toFixed(1)}%
              </span>
            </div>
            <p className="mt-1.5 text-muted-foreground">
              {topSectorSharePct >= 40
                ? "1 つの業種に大きく依存しています。その産業の景気や規制が変わると配当収入がまとめて減る可能性があります。"
                : topSectorSharePct >= 25
                  ? "やや偏りがあります。最大の業種が想定より減配した場合の影響を確認しておく価値があります。"
                  : "業種は分散しています。特定の産業の不振で配当がまとめて減る状態ではありません。"}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
