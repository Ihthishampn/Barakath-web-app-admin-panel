#!/usr/bin/env bash
# Live progress for the Barkath audit workflow.
#
#   bash scripts/audit-progress.sh          # newest run
#   bash scripts/audit-progress.sh wf_xxx   # a specific run
#   watch -n 20 bash scripts/audit-progress.sh   # auto-refresh
#
# The first line is the answer to "is it done yet?" — DONE or RUNNING.
W=/home/h/.claude/projects/-home-h-barkath/f39bf4f1-2ed5-4fb8-ad73-20f608ad5024/subagents/workflows

if [ -n "$1" ]; then
  D="$W/$1"
else
  # Newest run = the workflow dir whose journal was written most recently.
  D=$(ls -1dt "$W"/wf_*/ 2>/dev/null | while read -r d; do
        [ -f "$d/journal.jsonl" ] && printf '%s %s\n' "$(stat -c %Y "$d/journal.jsonl")" "$d"
      done | sort -rn | head -1 | cut -d' ' -f2-)
fi
[ -n "$D" ] && [ -d "$D" ] || { echo "no workflow run found"; exit 1; }

python3 - "$D" <<'PY'
import json,sys,glob,os,time,collections
D=sys.argv[1].rstrip('/')
started=results=0; findings=[]; verdicts=collections.Counter()
for l in open(os.path.join(D,'journal.jsonl')):
    try: d=json.loads(l)
    except: continue
    if d.get('type')=='started': started+=1; continue
    if d.get('type')!='result': continue
    results+=1
    r=d.get('result')
    if isinstance(r,str):
        try: r=json.loads(r)
        except: r=None
    if isinstance(r,dict):
        for k in ('findings','issues','bugs'):
            if k in r: findings += r[k] or []
        if 'refuted' in r: verdicts['refuted' if r['refuted'] else 'CONFIRMED']+=1
        elif str(r.get('verdict','')).upper()=='CONFIRMED': verdicts['CONFIRMED']+=1

newest=max((os.path.getmtime(f) for f in glob.glob(os.path.join(D,'agent-*.jsonl'))), default=0)
newest=max(newest, os.path.getmtime(os.path.join(D,'journal.jsonl')))
oldest=min((os.path.getmtime(f) for f in glob.glob(os.path.join(D,'*.meta.json'))), default=time.time())
idle=time.time()-newest

# Done = every started agent returned AND nothing has written for 3 minutes.
# The idle check matters: agent N can finish while agent N+1 has not started yet,
# so started==results alone flickers true mid-run.
done = started==results and idle>180
print(f"STATUS:        {'DONE  ✅' if done else 'RUNNING ⏳'}   ({os.path.basename(D)})")
print(f"elapsed:       ~{int((time.time()-oldest)//60)}m")
print(f"agents:        {results}/{started} finished" + ("" if done else f"  ({started-results} in flight)"))
def sevkey(f): return str(f.get('severity','?')).lower()
sev=collections.Counter(sevkey(f) for f in findings if isinstance(f,dict))
print(f"raw findings:  {len(findings)}  {dict(sev) if sev else ''}")
print(f"verified:      {verdicts['CONFIRMED']} confirmed, {verdicts['refuted']} refuted")
print(f"last activity: {idle:.0f}s ago  (<90s = actively working)")
if findings:
    print("\nlatest raw findings (NOT yet verified):")
    for f in findings[-5:]:
        if not isinstance(f,dict): continue
        name=str(f.get('file','?')).split('/')[-1]
        print(f"  [{sevkey(f):8}] {name}: {str(f.get('title') or f.get('summary',''))[:78]}")
PY
