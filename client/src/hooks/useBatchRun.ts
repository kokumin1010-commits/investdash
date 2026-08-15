import { useCallback, useRef, useState } from "react";

/**
 * 本番（Autoscale / Cloud Run）のリクエスト上限は 180 秒。
 * 27 銘柄の一括処理は 4〜13 分かかるため 1 リクエストでは必ず切断される。
 *
 * サーバー側は `offset` から一定件数だけ処理して `nextOffset` を返すので、
 * このフックが `nextOffset` が null になるまで呼び出しを繰り返す。
 * 進捗（processed / total）を保持して画面に出せるようにしている。
 */

export type BatchResult = {
  total: number;
  processed: number;
  nextOffset: number | null;
};

export type BatchProgress = {
  /** 実行中かどうか */
  running: boolean;
  /** 処理済み件数 */
  processed: number;
  /** 全体件数（初回レスポンスで確定） */
  total: number;
};

const IDLE: BatchProgress = { running: false, processed: 0, total: 0 };

export function useBatchRun<R extends BatchResult>(options: {
  /** 1 バッチ分を実行する関数。offset を受け取り結果を返す */
  runBatch: (offset: number) => Promise<R>;
  /** 全バッチ完了時。累積結果の配列を受け取る */
  onDone: (results: R[]) => void | Promise<void>;
  onError: (error: unknown) => void;
  /** true を返したバッチで打ち切る（AI 利用枠切れなど） */
  shouldStop?: (result: R) => boolean;
}) {
  const [progress, setProgress] = useState<BatchProgress>(IDLE);
  // 二重起動を防ぐ。state だと同一レンダー内の連打を取りこぼす
  const runningRef = useRef(false);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setProgress({ running: true, processed: 0, total: 0 });

    const results: R[] = [];
    try {
      let offset: number | null = 0;
      while (offset !== null) {
        const res = await options.runBatch(offset);
        results.push(res);
        setProgress({ running: true, processed: res.processed, total: res.total });
        if (options.shouldStop?.(res)) break;
        offset = res.nextOffset;
      }
      await options.onDone(results);
    } catch (error) {
      options.onError(error);
    } finally {
      runningRef.current = false;
      setProgress(IDLE);
    }
  }, [options]);

  return { start, progress };
}
