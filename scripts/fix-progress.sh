#!/usr/bin/env bash
# Live progress for the running Barkath fix workflow.
D=/home/h/.claude/projects/-home-h-barkath/f39bf4f1-2ed5-4fb8-ad73-20f608ad5024/subagents/workflows/wf_e04f3946-a19
[ -d "$D" ] || { echo "workflow dir not found (not started yet?)"; exit 1; }
python3 - "$D" <<'PY'
import json,sys,glob,os,time
D=sys.argv[1]
started=done=0; fixed=skipped=0; rows=[]
for l in open(os.path.join(D,'journal.jsonl')):
    try: d=json.loads(l)
    except: continue
    if d['type']=='started': started+=1; continue
    done+=1; r=d.get('result') or {}
    if isinstance(r,dict) and 'fixed' in r:
        fixed+=len(r.get('fixed') or []); skipped+=len(r.get('skipped') or [])
        rows.append((len(r.get('fixed') or []), len(r.get('skipped') or []), (r.get('buildStatus') or '')[:60]))
agents=glob.glob(os.path.join(D,'agent-*.jsonl'))
newest=max((os.path.getmtime(f) for f in agents), default=0)
print(f"agents:        {started} started / {done} finished  (10 fix + 4 verify)")
print(f"findings:      {fixed} fixed, {skipped} skipped")
print(f"last activity: {time.time()-newest:.0f}s ago  (<120s = actively working)")
for f,s,b in rows: print(f"   fixed={f:3} skipped={s:3}  {b}")
PY
