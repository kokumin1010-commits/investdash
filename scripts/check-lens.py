import json,subprocess,urllib.request,collections
BASE="http://127.0.0.1:3000"
def post(p,b):
    r=urllib.request.Request(BASE+p,data=json.dumps(b).encode(),headers={"Content-Type":"application/json","User-Agent":"curl/8.5.0"})
    return json.load(urllib.request.urlopen(r,timeout=60))
tok=post("/api/trpc/auth.unlock",{"json":{"passcode":"1010"}})["result"]["data"]["json"]["token"]
r=urllib.request.Request(BASE+"/api/trpc/portfolio.overview?input="+urllib.parse.quote(json.dumps({"json":{}})),headers={"Authorization":"Bearer "+tok,"User-Agent":"curl/8.5.0"})
d=json.load(urllib.request.urlopen(r,timeout=220))["result"]["data"]["json"]
groups=d.get("groups") or []
print("銘柄数:",len(groups))
c=collections.Counter()
for g in groups:
    s=g.get("signal") or {}
    c[(s.get("wouldBuyNow"),s.get("priceVsValue"))]+=1
buy=collections.Counter(); pv=collections.Counter()
for g in groups:
    s=g.get("signal") or {}
    buy[s.get("wouldBuyNow")]+=1; pv[s.get("priceVsValue")]+=1
print("今から買うか:",dict(buy))
print("価格と価値:",dict(pv))
over=[g for g in groups if (g.get("signal") or {}).get("wouldBuyNow")=="NO" and (g.get("signal") or {}).get("priceVsValue")=="PRICE_AHEAD"]
print("\n買わない＋株価先行:",len(over),"件")
for g in sorted(over,key=lambda x:-(x.get("marketValueBase") or 0)):
    print(f"  {g['name']} ({g['symbol']}) 評価額¥{g.get('marketValueBase',0):,.0f} 構成比{g.get('weightPct') or 0:.1f}% 損益{g.get('pnlPct') if g.get('pnlPct') is not None else '—'}")
pa=[g for g in groups if (g.get("signal") or {}).get("priceVsValue")=="PRICE_AHEAD"]
print("\n株価が中身より速い:",len(pa),"件 / 評価額合計 ¥{:,.0f}".format(sum(g.get("marketValueBase") or 0 for g in pa)))
nb=[g for g in groups if (g.get("signal") or {}).get("wouldBuyNow")=="NO"]
print("今からは買わない:",len(nb),"件 / 評価額合計 ¥{:,.0f}".format(sum(g.get("marketValueBase") or 0 for g in nb)))
total=sum(g.get("marketValueBase") or 0 for g in groups)
print("全体 ¥{:,.0f} / 株価先行の占める割合 {:.1f}%".format(total,100*sum(g.get("marketValueBase") or 0 for g in pa)/total if total else 0))
