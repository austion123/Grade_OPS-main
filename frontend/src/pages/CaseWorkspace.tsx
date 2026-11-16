import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { isAxiosError } from "axios";
import { useAuth } from "@/auth/AuthContext";
import { api, type User } from "@/api/client";
import "./case.css";

const path = "/api/v1";
const titles: Record<string, string> = {
  admission: "案例准入价值", structure: "结构完整性", timeline: "问题描述与事件回放",
  root_cause: "根因分析", containment: "现场措施与验证", prevention: "长期改进",
  lessons: "经验总结与知识复用", evidence: "附录与证据",
};
const actionLabels = { include: "保留", hide: "隐藏且不计分", unscore: "保留审核、不计分", score: "恢复计分资格" };
type Action = { module: string; action: keyof typeof actionLabels };
type Intent = { actions?: Action[]; blocked?: string[]; token?: string; clarification?: string };
type Finding = {
  module: string; title: string; kind: string; conclusion: string; issue: string; basis: string;
  suggestion: string; evidence_needed: string; priority: boolean; ai_added: boolean; excluded: boolean;
  evidence: { page: number; quote: string }[];
};
type Report = {
  metadata: Record<string, { value: string; evidence: { page: number; quote: string } | null }>; case_type: string; admission: string; page_count: number; media_unread: boolean;
  findings: Finding[];
  score: { version: string; total: number | null; items: { id: string; module: string; weight: number; level: string | null; percent: number | null }[] } | null;
};
type Review = { id: string; filename: string; created_at: string; status: "parsing" | "reviewing" | "done" | "failed"; error: string | null; report?: Report };
const states = { parsing: "正在解析 PPT", reviewing: "审核中", done: "审核完成", failed: "审核失败" };

function errorText(error: unknown) {
  if (isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    return typeof detail === "string" && /[\u4e00-\u9fff]/.test(detail) ? detail : error.response?.status === 422
      ? "输入格式不正确，请检查后重试。" : "请求失败，请检查服务连接后重试。";
  }
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={close}>
    <div className="case-row split"><h2>{title}</h2><button onClick={close}>关闭</button></div>{children}
  </dialog>;
}

function IntentForm({ admin = false, onApply }: { admin?: boolean; onApply: (intent: Intent) => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Intent>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function recognize(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setPreview(undefined);
    try { setPreview((await api.post<Intent>(path + (admin ? "/case-admin/intent" : "/case-reviews/intent"), { text })).data); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  return <>
    <p className="case-muted">管理员要求 ＞ 员工要求 ＞ AI 建议。案例准入审核始终保留。</p>
    <form onSubmit={recognize}>
      <label>用一句话描述报告要求
        <textarea rows={3} maxLength={4000} required disabled={busy} value={text} onChange={e => { setText(e.target.value); setPreview(undefined); }}
          placeholder={admin ? "例如：保留根因分析和现场措施" : "例如：这次忽略经验总结的评分"} />
      </label>
      <div className="case-row"><button className="case-primary" disabled={busy || !text.trim()}>{busy ? "正在识别…" : "识别要求"}</button></div>
    </form>
    {error && <p role="alert" className="case-error">{error}</p>}
    <div aria-live="polite">
      {preview?.clarification && <p>{preview.clarification}</p>}
      {preview?.token && <>
        <h3>请确认识别结果</h3><Actions actions={preview.actions ?? []} />
        {!!preview.blocked?.length && <p className="case-muted">以下模块受必备规则或管理员要求保护：{preview.blocked.join("、")}</p>}
        <button className="case-primary" onClick={() => onApply(preview)}>确认应用</button>
      </>}
    </div>
  </>;
}

function Actions({ actions }: { actions: Action[] }) {
  return actions.length ? <ul className="case-actions-list">{actions.map(a => <li key={a.module + a.action}>{titles[a.module]}：{actionLabels[a.action]}</li>)}</ul>
    : <p className="case-muted">没有自定义调整。</p>;
}

function PasswordDialog({ close }: { close: () => void }) {
  const { signOut } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    if (data.password !== data.confirm) { setError("两次输入的新密码不一致。"); return; }
    setBusy(true); setError("");
    try { await api.put(path + "/users/me/password", data); signOut(); }
    catch (err) { setError(errorText(err)); setBusy(false); }
  }
  return <Modal title="修改密码" close={close}><form onSubmit={save}>
    <label>当前密码<input type="password" required name="current_password" autoComplete="current-password" /></label>
    <label>新密码<input type="password" required name="password" minLength={10} autoComplete="new-password" /></label>
    <label>确认新密码<input type="password" required name="confirm" minLength={10} autoComplete="new-password" /></label>
    <p className="case-muted">新密码至少 10 个字符，保存后需重新登录。</p>
    {error && <p className="case-error" role="alert">{error}</p>}
    <button className="case-primary" disabled={busy}>保存并退出登录</button>
  </form></Modal>;
}

export function CaseWorkspace() {
  const { user, signOut } = useAuth();
  const [password, setPassword] = useState(false);
  const admin = user?.role === "INSTRUCTOR";
  return <div className="case-app">
    <header className="case-header"><div className="case-row split case-shell">
      <div className="case-row"><span className="case-logo" aria-hidden="true">审</span><strong>工程案例审核</strong><span className="case-pill">{admin ? "管理员端" : "员工端"}</span></div>
      <div className="case-row"><span className="case-muted case-email">{user?.email}</span><button onClick={() => setPassword(true)}>修改密码</button><button onClick={signOut}>退出登录</button></div>
    </div></header>
    {admin ? <AdminDesk /> : <EmployeeDesk />}
    {password && <PasswordDialog close={() => setPassword(false)} />}
  </div>;
}

function EmployeeDesk() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"upload" | "history" | "report">("upload");
  const [from, setFrom] = useState<"upload" | "history">("upload");
  const [file, setFile] = useState<File>();
  const [settings, setSettings] = useState(false);
  const [intent, setIntent] = useState<Intent>();
  const [record, setRecord] = useState<Review>();
  const [shown, setShown] = useState<Review>();
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Review[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const busy = uploading || record?.status === "parsing" || record?.status === "reviewing";

  useEffect(() => {
    if (!record || (record.status !== "parsing" && record.status !== "reviewing")) return;
    let active = true;
    const id = record.id;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const { data } = await api.get<Review>(path + "/case-reviews/" + id);
        if (!active) return;
        setRecord(data);
        if (data.status !== "parsing" && data.status !== "reviewing") return;
      } catch (err) { if (active) setError(errorText(err)); }
      if (active) timer = setTimeout(poll, 1500);
    }
    timer = setTimeout(poll, 700);
    return () => { active = false; clearTimeout(timer); };
  }, [record?.id, record?.status]);

  useEffect(() => {
    if (view !== "history") return;
    let active = true;
    setLoading(true); setError("");
    api.get<Review[]>(path + "/case-reviews", { params: { offset: page * 50 } })
      .then(({ data }) => { if (active) setHistory(data); })
      .catch(err => { if (active) setError(errorText(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [view, page, record?.status]);

  function select(next?: File) {
    setError("");
    if (!next) return;
    if (!/\.pptx?$/i.test(next.name) || !next.size || next.size > 25 * 1024 * 1024) {
      setFile(undefined); setError("请选择不超过 25 MB 的 .ppt 或 .pptx 文件。"); return;
    }
    setFile(next); setRecord(undefined);
  }
  async function submit() {
    if (!file || busy) return;
    setUploading(true); setPercent(0); setError(""); setRecord(undefined);
    const form = new FormData();
    form.append("file", file);
    if (intent?.token) form.append("intent", intent.token);
    try {
      setRecord((await api.post<Review>(path + "/case-reviews", form, { onUploadProgress: e => {
        if (e.total) setPercent(Math.round(e.loaded * 100 / e.total));
      } })).data);
    } catch (err) { setError(errorText(err)); }
    finally { setUploading(false); }
  }
  async function open(item: Review) {
    setError("");
    try {
      const data = item.report ? item : (await api.get<Review>(path + "/case-reviews/" + item.id)).data;
      if (!data.report) throw new Error("报告尚未生成。");
      setShown(data); setFrom(view === "history" ? "history" : "upload"); setView("report");
    } catch (err) { setError(errorText(err)); }
  }
  return <main className="case-shell case-main">
    {view === "upload" && <>
      <div className="case-row split case-heading"><div><p className="case-kicker">员工工作台</p><h1>提交工程案例</h1><p className="case-muted">上传已编写完成的案例，查看审核结论和修改建议。</p></div>
        <button onClick={() => { setPage(0); setView("history"); }}>审核历史</button>
      </div>
      <section className="case-card">
        <div className="case-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) select(e.dataTransfer.files[0]); }}>
          <span className="case-logo" aria-hidden="true">↑</span><strong>上传案例演示文稿</strong><span className="case-muted">支持拖放 .ppt 和 .pptx，单个文件最多 25 MB</span>
          <input hidden ref={fileInput} type="file" accept=".ppt,.pptx" onChange={e => { select(e.target.files?.[0]); e.target.value = ""; }} />
          <button disabled={busy} onClick={() => fileInput.current?.click()}>选择文件</button>
        </div>
        <div className="case-row case-controls">
          <span className="case-file case-muted">{file?.name ?? "尚未选择文件"}</span>
          <button disabled={busy} onClick={() => setSettings(true)}>报告内容设置</button>
          <button className="case-primary" disabled={!file || busy} onClick={submit}>提交审核</button>
        </div>
        {intent ? <div className="case-row"><span>已确认本次报告要求</span><Actions actions={intent.actions ?? []}/><button disabled={busy} onClick={() => setIntent(undefined)}>清除要求</button></div>
          : <p className="case-muted">可在提交前设置报告内容或排除评分项。</p>}
      </section>
      {(uploading || record) && <section className="case-card" aria-live="polite">
        <h2>{uploading ? "上传中" : states[record!.status]}</h2>
        {busy && <progress aria-label="审核进度" max={100} value={uploading ? percent : undefined} />}
        {record?.error && <p className="case-error">{record.error}</p>}
        {record?.status === "done" && <button className="case-primary" onClick={() => open(record)}>查看审核报告</button>}
        {record?.status === "failed" && <button className="case-primary" onClick={submit}>重新提交</button>}
      </section>}
      {settings && <Modal title="报告内容设置" close={() => setSettings(false)}><IntentForm onApply={value => { setIntent(value); setSettings(false); }} /></Modal>}
    </>}
    {view === "history" && <>
      <button onClick={() => { setView("upload"); setError(""); }}>← 返回提交</button>
      <h1 className="case-heading">审核历史</h1>
      <section className="case-card" aria-busy={loading}>
        {!history.length && !loading && <p className="case-muted">暂无审核记录。</p>}
        {loading && <p role="status">正在加载…</p>}
        {!loading && history.map(item => <div className="case-record case-row split" key={item.id}>
          <div><strong>{item.filename}</strong><p className="case-muted">{new Date(item.created_at).toLocaleString("zh-CN")}</p>{item.error && <p className="case-error">{item.error}</p>}</div>
          <div className="case-row"><span className="case-pill">{states[item.status]}</span>{item.status === "done" && <button onClick={() => open(item)}>查看报告</button>}</div>
        </div>)}
        <div className="case-row">
          {page > 0 && <button disabled={loading} onClick={() => setPage(p => p - 1)}>上一页</button>}
          {history.length === 50 && <button disabled={loading} onClick={() => setPage(p => p + 1)}>下一页</button>}
        </div>
      </section>
    </>}
    {view === "report" && shown?.report && <>
      <button onClick={() => setView(from)}>← 返回{from === "history" ? "审核历史" : "提交"}</button>
      <ReportView key={shown.id} record={shown} report={shown.report} />
    </>}
    {error && <p role="alert" className="case-error">{error}</p>}
  </main>;
}

function ReportView({ record, report }: { record: Review; report: Report }) {
  const [active, setActive] = useState(report.findings[0]?.module);
  const finding = report.findings.find(f => f.module === active);
  const focus = report.findings.filter(f => f.priority).slice(0, 3);
  const score = report.score;
  return <>
    <div className="case-heading"><p className="case-kicker">审核完成</p><h1>工程案例智能审核报告</h1>
      <p className="case-muted">{record.filename} · {report.case_type} · {report.page_count} 页</p>

    </div>
    <div className="case-overview">
      <section className="case-card"><p className="case-muted">准入结论</p><h2>{report.admission}</h2></section>
      <section className="case-card"><p className="case-muted">案例质量评分</p><h2>{score?.total != null ? `${score.total} / 100` : score ? "待核实评分依据" : "待评分 · 未配置适用规则"}</h2>
        {score && <p className="case-muted">规则版本：{score.version}</p>}
      </section>
    </div>
    {report.findings.some(f => f.excluded) && <p className="case-muted">本次不计分：{report.findings.filter(f => f.excluded).map(f => f.title).join("、")}</p>}
    {report.media_unread && <p className="case-muted">检测到图片或图表，当前报告未识别其中的视觉信息。</p>}
    {!!focus.length && <section className="case-card"><h2>优先修改</h2>{focus.map(f => <div className="case-record" key={f.module}>
      <strong>{f.title}</strong><p>{f.issue || f.conclusion}</p>
      {f.evidence_needed && <p><strong>需要补充的证据：</strong>{f.evidence_needed}</p>}
      <a href="#case-report-detail" onClick={() => setActive(f.module)}>查看原文与修改建议</a>
    </div>)}</section>}
    <details className="case-card"><summary>案例基本信息</summary>
      <dl className="case-metadata">
        {Object.entries(report.metadata).map(([label, field]) => <div key={label}><dt>{label}</dt>
          <dd>{field.value}{field.evidence && <span className="case-muted"> · 第 {field.evidence.page} 页</span>}</dd></div>)}
        <div><dt>审核提交时间</dt><dd>{new Date(record.created_at).toLocaleString("zh-CN")}</dd></div>
      </dl>
    </details>
    <div className="case-report case-heading">
      <nav className="case-nav" aria-label="报告章节">{report.findings.map(f => <button key={f.module} aria-current={active === f.module}
        onClick={() => setActive(f.module)}>{f.title}{f.ai_added && <span className="case-pill">AI 新增</span>}</button>)}</nav>
      {finding && <article className="case-card" id="case-report-detail" aria-live="polite">
        <div className="case-row"><h2>{finding.title}</h2>{finding.ai_added && <span className="case-pill">AI 新增</span>}</div>
        <div className="case-row"><span className="case-pill">{finding.kind}</span>{finding.excluded && <span className="case-pill">不计分</span>}</div>
        <dl>{[["审核结论", finding.conclusion], ["审核依据", finding.basis], ["存在的问题", finding.issue], ["修改建议", finding.suggestion], ["需要补充的证据", finding.evidence_needed]].filter(([, value]) => value).map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <h3>原文证据</h3>
        {finding.evidence.length ? finding.evidence.map((e, i) => <blockquote key={i}><strong>第 {e.page} 页</strong><p>{e.quote}</p></blockquote>)
          : <p className="case-muted">没有可核对的原文引用。</p>}
        {score?.items.filter(i => i.module === active).map(i => <p key={i.id}>评分项 {i.id}：{i.percent == null ? "待核实" : `${i.percent}%`}（权重 {i.weight}）{i.level && ` · ${i.level}`}</p>)}
      </article>}
    </div>
  </>;
}

type RuleSummary = { version: string; case_type: string };
type Config = { base_url: string; model: string; key_saved: boolean; advice: string; rubrics: RuleSummary[]; policy: Action[] };
type Knowledge = { id: string; filename: string; size: number };
const panels = { model: "大模型 API", review: "评分建议", knowledge: "知识库", accounts: "账号管理" };
type Panel = keyof typeof panels;
const formatList = ".pdf,.docx,.pptx,.ppt,.xlsx,.odt,.ods,.odp,.txt,.md,.csv,.tsv,.json,.xml,.html,.htm";

function AdminDesk() {
  const [panel, setPanel] = useState<Panel>("model");
  return <main className="case-shell case-main case-admin">
    <nav className="case-nav" aria-label="管理员设置">{(Object.keys(panels) as Panel[]).map(key =>
      <button key={key} aria-current={panel === key ? "page" : undefined} onClick={() => setPanel(key)}>{panels[key]}</button>)}
    </nav>
    <div>
      {panel === "model" && <SettingsPanel key="model" panel="model" />}
      {panel === "review" && <SettingsPanel key="review" panel="review" />}
      {panel === "knowledge" && <KnowledgePanel />}
      {panel === "accounts" && <AccountsPanel />}
    </div>
  </main>;
}

function SettingsPanel({ panel }: { panel: "model" | "review" }) {
  const [config, setConfig] = useState<Config>();
  const [key, setKey] = useState("");
  const [ruleFile, setRuleFile] = useState<File>();
  const ruleInput = useRef<HTMLInputElement>(null);
  const [policy, setPolicy] = useState<Intent>();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    api.get<Config>(path + "/case-admin/settings").then(({ data }) => {
      if (live) setConfig(data);
    }).catch(err => { if (live) setError(errorText(err)); });
    return () => { live = false; };
  }, []);

  async function save(test = false) {
    if (!config || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (panel === "model") {
        const payload = { base_url: config.base_url, model: config.model, api_key: key };
        if (test) await api.post(path + "/case-admin/model/test", payload);
        else {
          await api.put(path + "/case-admin/model", payload);
          setConfig({ ...config, key_saved: true });
          setKey("");
        }
        setMessage(test ? "连接测试通过。" : "模型配置已保存。");
      } else {
        const form = new FormData();
        form.append("advice", config.advice);
        if (policy?.token) form.append("policy_token", policy.token);
        if (policy?.token === "") form.append("clear_policy", "true");
        if (ruleFile) form.append("file", ruleFile);
        const { data } = await api.put<{ rubrics: RuleSummary[] | null }>(
          path + "/case-admin/review-settings/import", form,
        );
        setConfig({ ...config, rubrics: data.rubrics ?? config.rubrics, policy: policy?.actions ?? config.policy });
        setRuleFile(undefined);
        if (ruleInput.current) ruleInput.current.value = "";
        setPolicy(undefined);
        setMessage(ruleFile ? "评分规则已导入，配置已保存。" : "评分建议和报告策略已保存。");
      }
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  return <>
    <div className="case-heading"><p className="case-kicker">管理员设置</p><h1>{panels[panel]}</h1>
      <p className="case-muted">{panel === "model" ? "配置 OpenAI 兼容接口，用于识别员工要求并审核案例。" : "设置工程审核重点、报告策略和正式评分规则。"}</p>
    </div>
    {!config && !error && <p role="status">正在加载…</p>}
    {config && <form className="case-card" onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy}>
        {panel === "model" ? <>
          <label>API 地址<input required type="url" value={config.base_url} placeholder="https://model.example.com/v1"
            onChange={e => setConfig({ ...config, base_url: e.target.value })} /></label>
          <label>模型名称<input required value={config.model} onChange={e => setConfig({ ...config, model: e.target.value })} /></label>
          <label>API 密钥<input type="password" autoComplete="off" value={key} required={!config.key_saved}
            placeholder={config.key_saved ? "已保存，留空使用原密钥" : "粘贴 API 密钥"} onChange={e => setKey(e.target.value)} /></label>
          <div className="case-row"><button type="button" disabled={!config.base_url || !config.model || (!key && !config.key_saved)}
            onClick={() => save(true)}>测试连接</button><button className="case-primary">保存配置</button></div>
        </> : <>
          <label>输入评分建议<textarea rows={5} maxLength={12000} value={config.advice}
            placeholder="例如：根因分析应说明失效机理，现场恢复应有测试记录。"
            onChange={e => setConfig({ ...config, advice: e.target.value })} /></label>
          <h2>报告内容策略</h2>
          <p className="case-muted">管理员策略优先。确认识别结果后，点击保存才会应用于新提交。</p>
          <Actions actions={policy?.actions ?? config.policy} />
          <div className="case-row">
            <button type="button" onClick={() => setDialog(true)}>设置报告内容要求</button>
            {(config.policy.length > 0 || policy) && <button type="button" onClick={() => setPolicy({ token: "", actions: [] })}>清除策略（待保存）</button>}
          </div>
          <details><summary>正式评分规则（可选）</summary>
            <p className="case-muted">每种案例类型可填写一套规则。请填写正式权重和具体得分条件；未配置时只输出审核判断。</p>
            <pre>{JSON.stringify([{ version: "规则版本", case_type: "完整版", criteria: [{ id: "R1", module: "root_cause", weight: 1, levels: { "此处填写正式得分条件": 100 } }] }], null, 2)}</pre>
            <p className="case-muted">模块 ID：{Object.keys(titles).filter(k => k !== "admission").join("、")}</p>
            <p>当前规则：{config.rubrics.length
              ? config.rubrics.map(rule => `${rule.case_type} · ${rule.version}`).join("、")
              : "未配置"}</p>
            <label>上传评分规则 JSON
              <input ref={ruleInput} type="file" accept=".json,application/json" onChange={e => {
                const file = e.target.files?.[0];
                setError(""); setMessage(""); setRuleFile(undefined);
                if (!file) return;
                if (!/\.json$/i.test(file.name) || !file.size || file.size > 25 * 1024 * 1024) {
                  e.target.value = "";
                  setError("请选择非空且不超过 25 MB 的 .json 文件。");
                  return;
                }
                setRuleFile(file);
              }} />
            </label>
            <p className="case-muted">支持 UTF-8 编码的 .json 文件，单个文件最多 25 MB。点击保存后，文件中的规则会替换当前规则。</p>
          </details>
          <button className="case-primary">保存建议与规则</button>
        </>}
      </fieldset>
    </form>}
    {busy && <p role="status">正在处理…</p>}
    {error && <p className="case-error" role="alert">{error}</p>}
    {message && <p className="case-success" role="status">{message}</p>}
    {dialog && <Modal title="管理员报告内容要求" close={() => setDialog(false)}><IntentForm admin onApply={intent => { setPolicy(intent); setDialog(false); }} /></Modal>}
  </>;
}

function KnowledgePanel() {
  const [rows, setRows] = useState<Knowledge[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function refresh() {
    const { data } = await api.get<Knowledge[]>(path + "/case-admin/knowledge");
    setRows(data);
  }
  useEffect(() => { void refresh().catch(err => setErrors([errorText(err)])); }, []);
  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true); setErrors([]);
    for (const file of files) {
      const data = new FormData(); data.append("file", file);
      try { await api.post(path + "/case-admin/knowledge", data); }
      catch (err) { setErrors(items => [...items, file.name + "：" + errorText(err)]); }
    }
    try { await refresh(); }
    catch (err) { setErrors(items => [...items, errorText(err)]); }
    finally { setBusy(false); }
  }
  async function remove(doc: Knowledge) {
    if (!window.confirm("从知识库移除「" + doc.filename + "」？")) return;
    setBusy(true); setErrors([]);
    try { await api.delete(path + "/case-admin/knowledge/" + doc.id); await refresh(); }
    catch (err) { setErrors([errorText(err)]); }
    finally { setBusy(false); }
  }
  return <>
    <div className="case-heading"><p className="case-kicker">管理员设置</p><h1>知识库</h1><p className="case-muted">添加 SOP、企业规范与历史案例，供审核时参考。</p></div>
    <section className="case-card">
      <div className="case-row split"><h2>知识库文档</h2><button className="case-primary" disabled={busy} onClick={() => fileInput.current?.click()}>添加文档</button></div>
      <p className="case-muted">支持 PDF、DOCX、Excel（XLSX）、PPT/PPTX、开放文档与常见文本格式。扫描件需先做 OCR。</p>
      <input type="file" multiple accept={formatList} ref={fileInput} hidden onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {busy && <p role="status">正在处理文档…</p>}
      {!rows.length && !busy && <p className="case-muted">暂无知识库文档。</p>}
      {rows.map(doc => <div className="case-row split case-record" key={doc.id}>
        <div><strong>{doc.filename}</strong><p className="case-muted">可检索 · {doc.size.toLocaleString("zh-CN")} 字符</p></div>
        <button disabled={busy} onClick={() => remove(doc)}>移除</button>
      </div>)}
      {errors.map((error, i) => <p key={i} className="case-error" role="alert">{error}</p>)}
    </section>
  </>;
}

function AccountsPanel() {
  const [rows, setRows] = useState<User[]>([]);
  const [dialog, setDialog] = useState<User | "create">();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const { data } = await api.get<User[]>(path + "/users/employees");
    setRows(data);
  }
  useEffect(() => { void refresh().catch(err => setError(errorText(err))); }, []);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dialog) return;
    setBusy(true); setError("");
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (dialog === "create") await api.post(path + "/users/employees", form);
      else await api.put(path + "/users/employees/" + dialog.id + "/password", form);
      setDialog(undefined); await refresh();
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  async function toggle(user: User) {
    if (user.is_active && !window.confirm("停用「" + user.email + "」？")) return;
    setBusy(true); setError("");
    try { await api.patch(path + "/users/employees/" + user.id, { is_active: !user.is_active }); await refresh(); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  return <>
    <div className="case-heading"><p className="case-kicker">管理员设置</p><h1>账号管理</h1><p className="case-muted">开通员工账号、重置密码和管理账号状态。</p></div>
    <section className="case-card">
      <div className="case-row split"><h2>员工账号</h2><button className="case-primary" disabled={busy} onClick={() => { setDialog("create"); setError(""); }}>新增员工</button></div>
      {!rows.length && <p className="case-muted">暂无员工账号。</p>}
      {rows.map(u => <div className="case-row split case-record" key={u.id}>
        <div className="case-row"><strong>{u.email}</strong><span className="case-pill">{u.is_active ? "已启用" : "已停用"}</span></div>
        <div className="case-row">
          <button disabled={busy} onClick={() => { setDialog(u); setError(""); }}>重置密码</button>
          <button disabled={busy} onClick={() => toggle(u)}>{u.is_active ? "停用" : "启用"}</button>
        </div>
      </div>)}
    </section>
    {!dialog && error && <p className="case-error" role="alert">{error}</p>}
    {dialog && <Modal title={dialog === "create" ? "新增员工" : "重置员工密码"} close={() => { if (!busy) { setDialog(undefined); setError(""); } }}>
      <form onSubmit={save}>
        {dialog === "create" ? <label>邮箱<input name="email" type="email" required /></label> : <p>{dialog.email}</p>}
        <label>{dialog === "create" ? "初始密码" : "新密码"}<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
        <p className="case-muted">密码至少 10 个字符，员工可以在首次登录后自行修改。</p>
        {error && <p className="case-error" role="alert">{error}</p>}
        <button className="case-primary" disabled={busy}>{busy ? "正在保存…" : "确认保存"}</button>
      </form>
    </Modal>}
  </>;
}
