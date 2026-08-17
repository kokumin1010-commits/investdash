"""相談 AI の回答を読める形で表示する確認用スクリプト。"""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/c1.json"
d = json.load(open(path))
r = d.get("result", {}).get("data", {}).get("json")
if not r:
    print(json.dumps(d, ensure_ascii=False)[:800])
    sys.exit(0)
ans = r.get("answer") or ""
print(f"consultationId: {r.get('consultationId')}")
print("-" * 60)
print(ans[:3000])
