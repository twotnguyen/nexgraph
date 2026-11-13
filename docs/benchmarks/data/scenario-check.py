import json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from fastapi.testclient import TestClient
from nexgraph_engine.api.app import create_app
TOKEN="s"*40
def run_index(c,h,pid,**body):
    t=time.perf_counter()
    jid=c.post(f"/v1/projects/{pid}/index",json=body,headers=h).json()["job_id"]
    while (j:=c.get(f"/v1/jobs/{jid}",headers=h).json())["state"] not in ("done","error"): time.sleep(0.1)
    return j, round(time.perf_counter()-t,1)
def client(tmp):
    app=create_app(TOKEN,{"testserver"},data_dir=tmp/"appdata"); return app, TestClient(app), {"Authorization":f"Bearer {TOKEN}"}
def main():
    out={}
    tmp=Path(tempfile.mkdtemp(prefix="ng-scn-"))
    # 2. dự án lớn chưa lập chỉ mục: quét sơ bộ, chọn thư mục con
    hermes=tmp/"hermes"; shutil.copytree("/tmp/eval/hermes-copy",hermes,ignore=shutil.ignore_patterns(".nexgraph"))
    app,c,h=client(tmp)
    pid=c.post("/v1/projects",json={"path":str(hermes)},headers=h).json()["project_id"]
    scan=c.get(f"/v1/projects/{pid}/scan",headers=h).json()
    out["2_large_scan"]={"files":scan["files"],"large":scan["large"],"threshold":scan["threshold"],"top_dirs":scan["top_dirs"][:5]}
    sub=min((d for d in scan["top_dirs"] if d["files"]>=100),key=lambda d:d["files"])["path"]
    j,s=run_index(c,h,pid,subdir=sub)
    stats=c.get(f"/v1/projects/{pid}/stats",headers=h).json()
    out["2_large_subdir"]={"subdir":sub,"state":j["state"],"seconds":s,"files":stats["files"],"nodes":sum(stats["nodes_by_kind"].values())}
    app.state.services.jobs.shutdown()
    # 3. Go / Java nhỏ
    for name,src,pattern in (("go","/Users/twot/Documents/CODE/DACN-CNTT/repo-reference/repo-graph-rag","*.go"),("java","/Users/twot/Documents/CODE/DACN-CNTT/repo-reference/joern","*.java")):
        d=tmp/name; d.mkdir()
        subprocess.run(["rsync","-a","--include","*/",f"--include={pattern}","--exclude","*","--prune-empty-dirs",src+"/",str(d)+"/"],check=True)
        app,c,h=client(tmp/name)
        pid=c.post("/v1/projects",json={"path":str(d)},headers=h).json()["project_id"]
        j,s=run_index(c,h,pid)
        stats=c.get(f"/v1/projects/{pid}/stats",headers=h).json()
        out[f"3_{name}"]={"state":j["state"],"seconds":s,"files":stats["files"],"languages":stats["languages"],"nodes":sum(stats["nodes_by_kind"].values()),"edges":sum(stats["edges_by_type"].values())}
        app.state.services.jobs.shutdown()
    # 5. không có .git
    d=tmp/"nogit"; shutil.copytree("/tmp/eval/nestjs",d,ignore=shutil.ignore_patterns(".git","node_modules"))
    app,c,h=client(tmp/"nogit")
    pid=c.post("/v1/projects",json={"path":str(d)},headers=h).json()["project_id"]
    j,s=run_index(c,h,pid)
    p=d/"src/common/utils/string-util/string-util.service.ts"
    p.write_text(p.read_text().replace("return await bcrypt.compare(value, valueHashed);","return await bcrypt.compare(value, valueHashed); // sửa"))
    ch=c.get(f"/v1/projects/{pid}/changes",headers=h).json()
    out["5_no_git"]={"index_state":j["state"],"base":ch["base"],"note":ch["note"],"changed_files":[f["path"] for f in ch["changed_files"]],"impacted":len(ch["impacted"]),"tests":len(ch["tests"]),"stale":c.get(f"/v1/projects/{pid}/stats",headers=h).json()["stale"]}
    app.state.services.jobs.shutdown()
    print(json.dumps(out,indent=2,ensure_ascii=False))
    shutil.rmtree(tmp,ignore_errors=True)
if __name__=="__main__": main()
