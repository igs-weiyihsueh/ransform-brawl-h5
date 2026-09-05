/**
 * InputSource — 玩家操控意圖的來源（多人遷移 S2，決策 8fb9c890 Q4）。
 *
 * PlayerControl 透過每個 player 的 InputSource 取意圖（pull-based），
 * 而不直接讀 ctx.input。S2 時 P1 的 InputSource = 現有 InputSystem（人類鍵盤/滑鼠）；
 * S4 的 AI 會是另一個 InputSource 實作（產生相同意圖）。介面 = PlayerControl 實際用到的那組。
 */
export interface InputSource {
  /** 正規化移動向量（-1..1，斜向已正規化）。 */
  getMoveVector(): { x: number; y: number };
  /** 這一幀是否剛按下攻擊（edge）。 */
  justPressedAttack(): boolean;
  /** 這一幀是否剛按下衝刺（edge）。 */
  justPressedDash(): boolean;
}
