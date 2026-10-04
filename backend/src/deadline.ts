import { ApiError } from "./contract.js";

export async function withTimeout<T>(operation: Promise<T>, milliseconds: number, error: ApiError): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(error), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
