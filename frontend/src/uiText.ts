import type { AxiosError } from "axios";

export function roleLabel(role: string) {
  return role === "INSTRUCTOR" ? "教师" : role === "TA" ? "助教" : "未知角色";
}

const runStatuses: Record<string, string> = {
  PENDING: "等待评分",
  RUNNING: "评分中",
  DONE: "已完成",
  FAILED: "评分失败",
};

export function runStatusLabel(status: string) {
  return runStatuses[status] ?? "未知状态";
}

const reviewActions = { APPROVE: "通过", OVERRIDE: "已改分", FLAG: "已标记" };

export function reviewActionLabel(action: keyof typeof reviewActions) {
  return reviewActions[action];
}

const flags: Record<string, string> = {
  UNREADABLE: "内容无法识别",
  LOW_OCR_CONFIDENCE: "文字识别置信度低",
  LLM_PARSE_ERROR: "模型响应解析失败",
  LLM_API_ERROR: "模型调用失败",
  NEEDS_REVIEW: "待复核",
  VERIFIED_APPROVED: "校验通过",
  VERIFIED_CORRECTED: "校验后已更正",
  MATH_CORRECTED: "分数已更正",
  VERIFY_PARSE_ERROR: "校验响应解析失败",
};

export function flagLabel(flag: string) {
  if (flag.startsWith("VERIFY_ERROR_")) return "校验失败";
  if (flag.startsWith("VERIFY_UNKNOWN_VERDICT_")) return "校验结论无法识别";
  return flags[flag] ?? flag;
}

const errorMessages: Record<string, string> = {
  "Incorrect email or password": "邮箱或密码错误。",
  "User is inactive": "此账号已停用。",
  "Could not validate credentials": "登录已失效，请重新登录。",
  "Exam not found": "找不到该试卷。",
  "Grade not found": "找不到该评分结果。",
  "PDF not found": "找不到该 PDF。",
  "OVERRIDE requires override_score": "请填写修改后的分数。",
  "No PDFs uploaded for this exam yet.": "请先上传学生答卷 PDF。",
  "GEMINI_API_KEY is not configured on the backend.": "后端尚未配置 Gemini API 密钥。",
};

export function apiErrorText(error: AxiosError<{ detail?: unknown }>, fallback: string) {
  const detail = error.response?.data?.detail;
  if (typeof detail === "string") {
    if (Object.hasOwn(errorMessages, detail)) return errorMessages[detail];
    if (detail.startsWith("Requires role:")) return "当前账号无权执行此操作。";
    if (detail.startsWith("An exam with exam_id=")) return "该试卷编号已存在。";
    if (detail.startsWith("Rubric is missing required fields:")) return "评分标准缺少必填字段。";
    if (detail.startsWith("Grading failed:")) return "评分失败，请重试或查看后端日志。";
  }
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return "请求超时，请重试。";
  if (error.code === "ERR_NETWORK") return "无法连接服务，请检查网络或后端是否已启动。";
  return fallback;
}

export function uploadRejectionText(reason: string) {
  if (reason === "missing filename") return "缺少文件名";
  if (reason === "not a .pdf") return "文件格式必须是 PDF";
  return reason;
}

export function gradingText(text: string) {
  if (text === "Demo grade synthesized from rubric (no LLM call).") {
    return "根据评分标准生成的模拟评分，未调用模型。";
  }
  return text
    .replace(/^Solution satisfies '(.*)' — all key steps shown\.$/, "符合「$1」要求，关键步骤完整。")
    .replace(/^Largely correct on '(.*)'; minor steps missing or rushed\.$/, "基本符合「$1」要求，部分步骤略有遗漏。")
    .replace(/^Partial credit: concept identified for '(.*)' but execution incomplete\.$/, "部分得分：已识别「$1」相关概念，解答过程不完整。")
    .replace(/^Significant gaps in '(.*)' — recommend manual review\.$/, "「$1」存在明显遗漏，建议人工复核。");
}
