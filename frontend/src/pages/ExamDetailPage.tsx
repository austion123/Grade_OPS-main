import { apiErrorText, uploadRejectionText } from "@/uiText";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AxiosError } from "axios";
import {
  clearExamGrades,
  clearExamPdfs,
  deleteExam,
  getExam,
  getExamGrades,
  listExamPdfs,
  listPlagiarism,
  triggerGrading,
  uploadExamPdfs,
  type ExamDetail,
  type ExamPdf,
  type GradeSummary,
  type PlagiarismPair,
  type UploadSummary,
} from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { GradesSection } from "@/pages/GradesSection";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExamDetailPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isInstructor = user?.role === "INSTRUCTOR";

  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [pdfs, setPdfs] = useState<ExamPdf[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lastSummary, setLastSummary] = useState<UploadSummary | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [grades, setGrades] = useState<GradeSummary | null>(null);
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);

  const [plagiarism, setPlagiarism] = useState<PlagiarismPair[]>([]);

  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const [manageBusy, setManageBusy] = useState<"resetGrades" | "deleteExam" | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!examId) return;
    try {
      const [e, list, g, p] = await Promise.all([
        getExam(examId),
        listExamPdfs(examId),
        getExamGrades(examId),
        listPlagiarism(examId),
      ]);
      setExam(e);
      setPdfs(list);
      setGrades(g);
      setPlagiarism(p);
    } catch (err) {
      const ax = err as AxiosError<{ detail?: string }>;
      setError(apiErrorText(ax, "无法加载试卷详情。"));
    }
  }, [examId]);

  async function doResetGrades() {
    if (!examId) return;
    if (
      !confirm(
        "确定重置本试卷的评分结果？所有学生成绩、助教复核记录及相似度标记将被删除，答卷 PDF 会保留。",
      )
    )
      return;
    setManageBusy("resetGrades");
    setManageError(null);
    try {
      await clearExamGrades(examId);
      await refresh();
      setGrades(null);
    } catch (err) {
      const ax = err as AxiosError<{ detail?: string }>;
      setManageError(apiErrorText(ax, "操作失败，请重试。"));
    } finally {
      setManageBusy(null);
    }
  }

  async function doDeleteExam() {
    if (!examId || !exam) return;
    if (
      !confirm(
        `确定删除试卷「${exam.exam_id}」？\n\n评分标准、答卷 PDF、评分记录、复核记录及相似度标记都将被删除。此操作无法撤销。`,
      )
    )
      return;
    setManageBusy("deleteExam");
    setManageError(null);
    try {
      await deleteExam(examId);
      navigate("/exams", { replace: true });
    } catch (err) {
      const ax = err as AxiosError<{ detail?: string }>;
      setManageError(apiErrorText(ax, "操作失败，请重试。"));
      setManageBusy(null);
    }
  }

  async function doClear() {
    if (!examId) return;
    if (!confirm("确定删除本试卷的所有答卷 PDF？此操作无法撤销。")) return;
    setClearing(true);
    setClearError(null);
    try {
      await clearExamPdfs(examId);
      await refresh();
    } catch (err) {
      const ax = err as AxiosError<{ detail?: string }>;
      setClearError(apiErrorText(ax, "清空答卷失败，请重试。"));
    } finally {
      setClearing(false);
    }
  }

  async function doGrade() {
    if (!examId) return;
    setGrading(true);
    setGradeError(null);
    try {
      const summary = await triggerGrading(examId);
      setGrades(summary);
    } catch (err) {
      const ax = err as AxiosError<{ detail?: string }>;
      setGradeError(apiErrorText(ax, "评分失败，请重试。"));
    } finally {
      setGrading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPending(files);
    setLastSummary(null);
    setUploadError(null);
  }

  async function doUpload() {
    if (!examId || pending.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const summary = await uploadExamPdfs(examId, pending);
      setLastSummary(summary);
      setPending([]);
      await refresh();
    } catch (err) {
      const ax = err as AxiosError<{ detail?: string }>;
      setUploadError(apiErrorText(ax, "上传失败，请重试。"));
    } finally {
      setUploading(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/exams" className="text-xs font-medium text-accent hover:underline">
          ← 返回试卷列表
        </Link>
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link to="/exams" className="text-xs font-medium text-accent hover:underline">
        ← 返回试卷列表
      </Link>

      {exam ? (
        <header className="mt-2 border-b border-slate-200 pb-6">
          <p className="text-xs font-mono text-ink-muted">{exam.exam_id}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{exam.title}</h1>
          <p className="text-sm text-ink-muted">{exam.course}</p>
        </header>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">加载中…</p>
      )}

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-ink">上传学生答卷 PDF</h2>
        <p className="mt-1 text-sm text-ink-muted">
          每位学生对应一份 PDF，文件命名格式为
          <code>{`{student_id}.pdf`}</code>，例如 <code>STU001.pdf</code>。
          也支持旧版按题命名的文件，例如 <code>STU001_Q1.pdf</code>。
        </p>

        <input
          id="answer-files"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={onPick}
          className="peer sr-only"
        />
        <label
          htmlFor="answer-files"
          className="mt-2 inline-block cursor-pointer rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-slate-200 peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
        >
          选择答卷 PDF
        </label>

        {pending.length > 0 && (
          <p className="mt-2 text-xs text-ink-muted">
            已选择 {pending.length} 个文件 ·{" "}
            {pending.map((f) => f.name).join(", ")}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={pending.length === 0 || uploading}
            onClick={doUpload}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? "上传中…" : pending.length ? `上传 ${pending.length} 个 PDF` : "上传 PDF"}
          </button>
        </div>

        {uploadError && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {uploadError}
          </div>
        )}

        {lastSummary && (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-emerald-800">
              已上传 {lastSummary.uploaded.length} 个文件。
            </p>
            {lastSummary.rejected.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <p className="font-medium">未上传的文件</p>
                <ul className="ml-4 list-disc text-xs">
                  {lastSummary.rejected.map((r, i) => (
                    <li key={i}>
                      <span className="font-mono">{r.filename === "(no name)" ? "未命名文件" : r.filename}</span> — {uploadRejectionText(r.reason)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-ink">评分</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {isInstructor
                ? "识别已上传答卷的内容并进行模型评分。结果会显示在下方。"
                : "只有教师可以发起评分。结果会显示在下方。"}
            </p>
          </div>
          <div className="flex gap-2">
            {grades && (
              <button
                type="button"
                onClick={() => navigate(`/exams/${examId}/review`)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink-soft shadow-sm transition hover:bg-slate-50"
              >
                打开复核队列
              </button>
            )}
            {isInstructor && (
              <button
                type="button"
                disabled={grading || !pdfs || pdfs.length === 0}
                onClick={doGrade}
                className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {grading ? "评分中…" : grades ? "重新评分" : "开始评分"}
              </button>
            )}
          </div>
        </div>

        {grading && (
          <p className="mt-3 text-xs text-ink-muted">
            正在处理答卷并检查评分结果，可能需要几分钟。
          </p>
        )}
        {gradeError && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {gradeError}
          </div>
        )}
      </section>

      {plagiarism.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-semibold text-ink">可疑相似答卷</h2>
          <p className="mt-1 text-xs text-ink-muted">
            最近一次评分中余弦相似度达到 0.65 的答卷配对。
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/40 shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-amber-50 text-left text-xs uppercase tracking-wide text-amber-900">
                <tr>
                  <th className="px-4 py-2 font-medium">题目</th>
                  <th className="px-4 py-2 font-medium">学生甲</th>
                  <th className="px-4 py-2 font-medium">学生乙</th>
                  <th className="px-4 py-2 font-medium">相似度</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {plagiarism.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-mono text-xs">{p.question_id}</td>
                    <td className="px-4 py-2 font-mono text-xs">{p.student_a}</td>
                    <td className="px-4 py-2 font-mono text-xs">{p.student_b}</td>
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-amber-900">
                      {p.score.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {grades && <GradesSection summary={grades} examIdentifier={exam?.exam_id ?? "export"} />}

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">已上传答卷 PDF</h2>
          {pdfs && pdfs.length > 0 && (
            <button
              type="button"
              onClick={doClear}
              disabled={clearing}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {clearing ? "清空中…" : `清空全部（${pdfs.length}）`}
            </button>
          )}
        </div>
        {clearError && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {clearError}
          </div>
        )}
        {pdfs === null ? (
          <p className="mt-2 text-sm text-ink-muted">加载中…</p>
        ) : pdfs.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">暂无答卷。</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">文件名</th>
                  <th className="px-4 py-3 font-medium">学生</th>
                  <th className="px-4 py-3 font-medium">题目</th>
                  <th className="px-4 py-3 font-medium">大小</th>
                  <th className="px-4 py-3 font-medium">上传时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pdfs.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-mono text-xs">{p.filename}</td>
                    <td className="px-4 py-3">{p.student_id ?? "—"}</td>
                    <td className="px-4 py-3">{p.question_id ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted">{formatBytes(p.size_bytes)}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {new Date(p.created_at).toLocaleString("zh-CN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isInstructor && exam && (
        <section className="mt-10 rounded-lg border border-red-200 bg-red-50/40 p-6">
          <h2 className="text-base font-semibold text-red-900">管理试卷</h2>
          <p className="mt-1 text-sm text-red-800/80">
            重置评分或删除试卷后，删除的记录无法恢复。
          </p>
          {manageError && (
            <div className="mt-3 rounded-md border border-red-300 bg-red-100 px-3 py-2 text-sm text-red-800">
              {manageError}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={doResetGrades}
              disabled={manageBusy !== null || !grades}
              className="rounded-md border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-800 shadow-sm transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {manageBusy === "resetGrades"
                ? "重置中…"
                : "重置评分结果"}
            </button>
            <button
              type="button"
              onClick={doDeleteExam}
              disabled={manageBusy !== null}
              className="rounded-md border border-red-400 bg-white px-3 py-2 text-sm font-medium text-red-800 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {manageBusy === "deleteExam" ? "删除中…" : "删除此试卷"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
