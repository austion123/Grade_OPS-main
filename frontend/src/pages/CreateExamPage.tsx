import { apiErrorText } from "@/uiText";
import { useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AxiosError } from "axios";
import { createExam } from "@/api/client";

export function CreateExamPage() {
  const navigate = useNavigate();
  const [filename, setFilename] = useState<string | null>(null);
  const [rubric, setRubric] = useState<Record<string, unknown> | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setServerError(null);
    setRubric(null);
    setFilename(null);

    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setParseError("评分标准 JSON 的顶层必须是对象。");
          return;
        }
        const missing = ["exam_id", "course"].filter((k) => !parsed[k]);
        if (missing.length > 0) {
          setParseError(`缺少必填字段： ${missing.join(", ")}`);
          return;
        }
        if (typeof parsed.total_marks !== "number") {
          setParseError("评分标准的 total_marks 字段必须为数字。");
          return;
        }
        if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
          setParseError("评分标准的 questions 字段至少要包含一道题。");
          return;
        }
        setRubric(parsed as Record<string, unknown>);
      } catch {
        setParseError("JSON 格式无效，请检查文件内容。");
      }
    };
    reader.readAsText(file);
  }

  async function onSubmit() {
    if (!rubric) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const exam = await createExam(rubric);
      navigate(`/exams/${exam.id}`, { replace: true });
    } catch (err) {
      const ax = err as AxiosError<{ detail?: string }>;
      setServerError(apiErrorText(ax, "创建试卷失败，请重试。"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link to="/exams" className="text-xs font-medium text-accent hover:underline">
        ← 返回试卷列表
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">新建试卷</h1>
      <p className="mt-1 text-sm text-ink-muted">
        请上传评分标准 JSON 文件，需包含 <code>exam_id</code> 和 <code>course</code>
        （<code>title</code> 可选，省略时显示 <code>exam_id</code>）。
      </p>

      <div className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-sm font-medium text-ink-soft">评分标准 JSON</p>
          <input
            id="rubric-file"
            type="file"
            accept="application/json,.json"
            onChange={onFile}
            className="peer sr-only"
          />
          <label
            htmlFor="rubric-file"
            className="mt-2 inline-block cursor-pointer rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-slate-200 peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
          >
            选择评分标准文件
          </label>
          {filename && (
            <p className="mt-1 text-xs text-ink-muted">已选择： {filename}</p>
          )}
        </div>

        {parseError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {parseError}
          </div>
        )}

        {rubric && !parseError && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            已解析： <span className="font-mono">{String(rubric.exam_id)}</span> ·{" "}
            {String(rubric.course)}
            {rubric.title ? ` · ${String(rubric.title)}` : ""}
          </div>
        )}

        {serverError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Link
            to="/exams"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink-soft shadow-sm transition hover:bg-slate-50"
          >
            取消
          </Link>
          <button
            type="button"
            disabled={!rubric || submitting}
            onClick={onSubmit}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "创建中…" : "创建试卷"}
          </button>
        </div>
      </div>
    </div>
  );
}
