class AppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.status = Number(status) || 500;
    this.code = options.code || "";
  }
}

function isAppError(error) {
  return error instanceof AppError;
}

function toErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || "未知错误");
}

function toHttpError(error, fallbackMessage = "服务内部错误") {
  if (isAppError(error)) {
    return {
      status: error.status,
      message: error.message,
      code: error.code,
    };
  }

  return {
    status: 500,
    message: `${fallbackMessage}：${toErrorMessage(error)}`,
    code: "INTERNAL_ERROR",
  };
}

module.exports = {
  AppError,
  isAppError,
  toErrorMessage,
  toHttpError,
};
