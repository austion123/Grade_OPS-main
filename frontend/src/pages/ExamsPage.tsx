import { apiErrorText } from "@/uiText";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deleteExam, listExams, type ExamSummary } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { AxiosError } from "axios";

export function ExamsPage() {
  const { user, signOut } = useAuth();
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    listExams()
      .then(setExams)
      .catch((e: AxiosError<{ detail?: string }>) => {
        setError(apiErrorText(e, "无法加载试卷，请重试。"));
      });
  }, []);

  async function onDelete(exam: ExamSummary) {
    if (
      !confirm(
        `确定删除试卷「${exam.exam_id}」？\n\n答卷 PDF、评分记录、复核记录及相似度标记也会被删除。此操作无法撤销。`,
      )
    )
      return;
    setDeletingId(exam.id);
    setError(null);
    try {
      await deleteExam(exam.id);
      setExams((prev) => (prev ? prev.filter((e) => e.id !== exam.id) : prev));
    } catch (e) {
      const ax = e as AxiosError<{ detail?: string }>;
      setError(apiErrorText(ax, "删除试卷失败，请重试。"));
    } finally {
      setDeletingId(null);
    }
  }

  if (!user) return null;
  const isInstructor = user.role === "INSTRUCTOR";

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-start justify-between border-b border-slate-200 pb-6">
        <div>
          <Link to="/" className="text-xs font-medium text-accent hover:underline">
            ← 返回首页
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">试卷列表</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {isInstructor
              ? "根据评分标准创建试卷，再上传学生答卷 PDF。"
              : "选择试卷并上传学生答卷 PDF。"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isInstructor && (
            <Link
              to="/exams/new"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-hover"
            >
              新建试卷
            </Link>
          )}
          <button
            onClick={signOut}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-ink-soft shadow-sm transition hover:bg-slate-50"
          >
            退出登录
          </button>
        </div>
      </header>

      <main className="mt-8">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {exams === null && !error && (
          <p className="text-sm text-ink-muted">加载中…</p>
        )}

        {exams && exams.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm text-ink-muted">暂无试卷。</p>
            {isInstructor && (
              <p className="mt-1 text-xs text-ink-muted">
                点击<span className="font-medium">新建试卷</span>上传评分标准。
              </p>
            )}
          </div>
        )}

        {exams && exams.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">试卷编号</th>
                  <th className="px-4 py-3 font-medium">课程</th>
                  <th className="px-4 py-3 font-medium">标题</th>
                  <th className="px-4 py-3 font-medium">答卷 PDF</th>
                  <th className="px-4 py-3 font-medium">创建时间</th>
                  {isInstructor && <th className="px-4 py-3 font-medium text-right">操作</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {exams.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-ink-soft">
                      <Link to={`/exams/${e.id}`} className="text-accent hover:underline">
                        {e.exam_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{e.course}</td>
                    <td className="px-4 py-3">{e.title}</td>
                    <td className="px-4 py-3 text-ink-muted">{e.pdf_count}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {new Date(e.created_at).toLocaleString("zh-CN")}
                    </td>
                    {isInstructor && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={deletingId === e.id}
                          onClick={() => onDelete(e)}
                          className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingId === e.id ? "删除中…" : "删除"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
