/**
 * contactSolver.ts — Unity ContactSolver 的 H5 TS 移植【草案，蟲騎 review 用，尚未接線】。
 *
 * 來源：瓢蟲少女 Unity 專案 Assets/Game/Script/Character/Villain/ContactSolver.cs（蟲騎提供）。
 * 定位（與征騎 SurroundSlotManager 整合）：槽位分配(A surroundSlots)給大方向 + 分離力(B)移動 →
 *   **本檔取代收尾解重疊層(C，原 enemySeparation.resolveEnemyOverlap)**，帶入 Unity 的防抖/質量分攤/平均鬆弛。
 *
 * 純函式、零 Phaser、零遊戲 runtime 依賴（可測）。H5 2D：Unity 的 delta.y=0（XZ 平面）直接省略，用 {x,y}。
 *
 * ★對齊蟲騎 5 點避雷：
 *  [1] 時序：呼叫端「所有實體先 move（含玩家 paceMove 預減速）」→ 再跑 solveContacts（相當 Unity Update→LateUpdate）。
 *      pushPairs 當幀由 paceMove 產生、solveContacts 消費、跑完清空（呼叫端持有這個 Set，本檔不留狀態）。
 *  [2] Apply 順序：count>1 先除以 count（平均）→ 再 ×jacobiRelaxation（鬆弛）→ 才位移。
 *  [3] Compute early-out 順序照搬：minDist<=0 → sqrMag<eps → corrected<=0，最貴的 CanBePushed 讀取擺最後。
 *  [4] 質量分攤：mass=體型（小怪輕/菁英重）；canBePushed=movable（攻擊中菁英/像牆→false 當無限質量）；sum<=0 fallback 各半。
 *  [5] snapshot 壓平不移植（TS 無 interface dispatch/native transform 成本，直接讀屬性）。
 *
 * ============================================================================
 * 【接線設計筆記 — 等異靈派 ContactSolver 整合任務時照這做（草案階段先記，勿接線）】
 * ============================================================================
 *
 * ◆ A/B 開關 useSlotFormation（用戶 setusyoi 想比較「槽位法 vs 純湧現法」）：
 *   - 加一個開關（建議 editorStore key 'surroundMode' 或 gameConfig，可接進編輯器 overlay toggle 讓遊戲內即時切）。
 *   - 旁路點在 **EnemySpawner.coordinateSurround()**：useSlotFormation===false → 對每隻 e.setSlotTarget(null,null)
 *     直接 continue（跳過 claim/tryClaimInner/SurroundSlotManager 整套）。
 *   - **Enemy/moveChase/surroundSlots 完全不動**：moveChase 遇 slotPos=null 本來就走 fallback
 *     「combineWithSeparation(朝玩家 aim, 分離力) 直線追」＝純湧現本體。
 *   - 停止條件已現成：進 charge 的 gate 在狀態機 shouldEnterCharge(dist<=attackPx && canReach)＝Unity ShouldSeekTarget，不用改。
 *   - true = 現有槽位法(A)、false = 純湧現(B)。同一套 code A/B 切換。
 *
 * ◆ ★純湧現法「糊同側」風險（蟲騎 Unity 洞察，接線務必記得）：
 *   - 我的分離力(B)是「遠離鄰居」不是「繞玩家散開」→ 所有怪目標都同一玩家點時，會在逼近側擠成半月形、繞不到背後。
 *   - **H5 比 Unity 嚴重**（不是輕微）：Unity 靠 (1) NavMesh 尋路製造多樣接近角度 (2) 多點 spawn 散在玩家四周
 *     天然分散；H5 沒 NavMesh、直線追、若集中 spawn → 糊同側會一眼明顯。這是湧現法在無尋路環境的先天限制，非 code bug。
 *   - **救法優先序（蟲騎定，接線後若太醜照此序試）**：
 *       1. 先跑純 Unity 版 A/B（分離力 + ContactSolver + aggro 加速施壓），讓用戶看原汁原味的真實結果再判斷。
 *       2. 若糊同側太醜 → 優先「分散怪 spawn 點/初始接近方向散在玩家四周」（模擬 Unity 多點 spawn+尋路繞路，
 *          最貼 Unity 精神、不算作弊）。
 *       3. 最後手段才加「輕微切向力（繞玩家 tangent）」——它等於把槽位環繞用力場偷渡回來，最不純，故墊底。
 *   - ★接線做 A/B 時「不偷加切向力」，才是公平的純湧現對比（蟲騎+征騎共識）。
 * ============================================================================
 */

/** 接觸體（對應 Unity IContactBody；H5 2D）。 */
export interface ContactBody {
  /**
   * 穩定識別（對應 Unity 用物件參考 (Pusher,Pushed) tuple 當 pushPairs key 的語意）。
   * ★用不隨陣列重建/順序改變的穩定 id（如 enemyId、'player0'）——蟲騎 review：index key 在
   *   paceMove→solveContacts 之間若 bodies spawn/die 重建/換序會對不上→push 不被消費（半套 push）。
   *   改用 stable id 對齊 Unity 物件參考，怪變多也不怕。
   */
  id: string;
  /** 世界座標（像素）。 */
  x: number;
  y: number;
  /** 碰撞/避讓半徑（像素）；pair 接觸距離 = 兩半徑相加。 */
  radius: number;
  /** 有效質量（體型；重的吃較少重疊份額→難推）。應非負；zero-mass pair fallback 各半。 */
  mass: number;
  /** 本幀是否可被位移（false=無限質量：自己不動、對手吃全部重疊；knockback/jump/攻擊位移/dead 時 false）。 */
  canBePushed: boolean;
}

export interface ContactSolverParams {
  /** 每幀鬆弛（0..1，Unity 0.5）：只推一半，多體群集幾幀平滑收斂、防彈飛。 */
  jacobiRelaxation: number;
  /** 容忍接觸深度（像素，Unity contactSlop）：容忍微量重疊，避免碰→彈→碰 stick-slip 抖動。 */
  contactSlop: number;
}

/** 預設參數（Unity relaxation=0.5；slop 先小值，headless/看圖微調到不抖不疊的最小）。 */
export const DEFAULT_CONTACT_SOLVER_PARAMS: ContactSolverParams = {
  jacobiRelaxation: 0.5,
  contactSlop: 2, // 像素（Unity 是公尺 × PPU；先 2px，實測調）
};

const EPS = 1e-5; // Vector3.kEpsilon 對應

/** pushPairs 的 key（"pusherId>pushedId"，穩定 id）：paceMove 記錄、solveContacts 消費。 */
export function pushPairKey(pusherId: string, pushedId: string): string {
  return `${pusherId}>${pushedId}`;
}

/**
 * 解接觸（Compute + Apply，對應 Unity LateUpdate 的後兩 pass）。純函式：不改輸入，回每體位移 + 新座標。
 * 兩兩(j>i)累積重疊 → 依質量/pushPairs 分攤 → count>1 平均 → ×relaxation → 位移（只動 canBePushed 者）。
 *
 * @param bodies 本幀 active-set（呼叫端已過濾 jumping/knockbacking/dead）。
 * @param pushPairs paceMove 當幀產生的「pusherId>pushedId」集合（穩定 id，無則傳空 Set）。
 * @param params relaxation/slop。
 * @returns { displacements, positions }：位移量 + 套用後新座標（呼叫端把 positions 寫回、或用 displacements 自行 Move）。
 */
export function solveContacts(
  bodies: readonly ContactBody[],
  pushPairs: ReadonlySet<string> = new Set(),
  params: ContactSolverParams = DEFAULT_CONTACT_SOLVER_PARAMS,
): { displacements: { x: number; y: number }[]; positions: { x: number; y: number }[] } {
  const n = bodies.length;
  const disp: { x: number; y: number }[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  const counts: number[] = new Array(n).fill(0);

  // Pass2 Compute：兩兩(j>i)。
  for (let i = 0; i < n; i += 1) {
    const a = bodies[i];
    for (let j = i + 1; j < n; j += 1) {
      const b = bodies[j];
      const minDist = a.radius + b.radius;
      if (minDist <= 0) continue; // early-out 1
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const sqr = dx * dx + dy * dy;
      if (sqr < EPS) continue; // early-out 2（幾乎完全重疊，方向不定 → 跳過，交下一幀微擾解）
      const dist = Math.sqrt(sqr);
      const corrected = minDist - dist - params.contactSlop; // 扣 slop
      if (corrected <= 0) continue; // early-out 3（未重疊或在容忍內）
      const ux = dx / dist;
      const uy = dy / dist;
      const aCan = a.canBePushed;
      const bCan = b.canBePushed;
      if (aCan && bCan) {
        const aPushing = pushPairs.has(pushPairKey(a.id, b.id)); // a 在 paceMove 已對 b 預減速
        const bPushing = pushPairs.has(pushPairKey(b.id, a.id));
        if (aPushing && !bPushing) {
          // a 已預減速吸收 → 整段重疊給 b（不對 a 再修正，避免質量比套兩次停滯）。
          counts[j] += 1; disp[j].x -= ux * corrected; disp[j].y -= uy * corrected;
        } else if (bPushing && !aPushing) {
          counts[i] += 1; disp[i].x += ux * corrected; disp[i].y += uy * corrected;
        } else {
          const sum = a.mass + b.mass;
          if (sum <= 0) {
            const half = corrected * 0.5; // zero-mass fallback 各半
            disp[i].x += ux * half; disp[i].y += uy * half;
            disp[j].x -= ux * half; disp[j].y -= uy * half;
          } else {
            const si = corrected * (b.mass / sum); // 重的吃少：i 分到 mB/sum
            const sj = corrected * (a.mass / sum);
            disp[i].x += ux * si; disp[i].y += uy * si;
            disp[j].x -= ux * sj; disp[j].y -= uy * sj;
          }
          counts[i] += 1; counts[j] += 1;
        }
      } else if (aCan) {
        // b 無限質量（像牆）→ a 吃全部。
        counts[i] += 1; disp[i].x += ux * corrected; disp[i].y += uy * corrected;
      } else if (bCan) {
        counts[j] += 1; disp[j].x -= ux * corrected; disp[j].y -= uy * corrected;
      }
      // 都不可推 → 跳過。
    }
  }

  // Pass3 Apply：平均 → 鬆弛 → 位移。
  const positions: { x: number; y: number }[] = bodies.map((b) => ({ x: b.x, y: b.y }));
  if (n >= 2) {
    for (let i = 0; i < n; i += 1) {
      if (!bodies[i].canBePushed) continue;
      let dxi = disp[i].x;
      let dyi = disp[i].y;
      const c = counts[i];
      if (c > 1) { dxi /= c; dyi /= c; } // 平均：被多隻包圍不加總彈飛
      dxi *= params.jacobiRelaxation; // 鬆弛
      dyi *= params.jacobiRelaxation;
      disp[i].x = dxi; disp[i].y = dyi;
      positions[i].x += dxi; positions[i].y += dyi;
    }
  }
  return { displacements: disp, positions };
}

/**
 * 玩家/推方移動前的速度層預減速（對應 Unity PaceMove，在 Update 呼叫）。純函式：不改輸入。
 * 把 desiredMove 中「朝各 body 接近、且本幀會撞進接觸距離」的分量，依質量份額削掉（重的推不動、削多）。
 * 並回報本幀新增的 pushPairs（self→body），供同幀 solveContacts 消費（被推方吃整段、推方不再被修正）。
 *
 * @param self 推方本體（須是 bodies 內的成員；用 id 比對，active-set 成員才參與，否則 solver 不會消費 pushPairs）。
 * @param desiredMove 期望位移（像素）。
 * @param bodies 本幀 active-set。
 * @param params slop/relaxation（此處只用 slop）。
 * @returns { move: 夾限後位移, pushPairs: 本幀新增的 key[] }。呼叫端把 pushPairs 併進當幀 Set 傳給 solveContacts。
 */
export function paceMove(
  self: ContactBody,
  desiredMove: { x: number; y: number },
  bodies: readonly ContactBody[],
  params: ContactSolverParams = DEFAULT_CONTACT_SOLVER_PARAMS,
): { move: { x: number; y: number }; pushPairs: string[] } {
  const pairs: string[] = [];
  let mx = desiredMove.x;
  let my = desiredMove.y;
  if (mx * mx + my * my < EPS) return { move: { x: mx, y: my }, pushPairs: pairs };
  if (!bodies.some((b) => b.id === self.id)) return { move: { x: mx, y: my }, pushPairs: pairs }; // 非 active-set 成員 → 不夾（否則 solver 不會消費）
  for (let i = 0; i < bodies.length; i += 1) {
    const body = bodies[i];
    if (body.id === self.id) continue;
    const dx = body.x - self.x;
    const dy = body.y - self.y;
    const sqr = dx * dx + dy * dy;
    if (sqr < EPS) continue;
    const dist = Math.sqrt(sqr);
    const ux = dx / dist;
    const uy = dy / dist;
    const approach = mx * ux + my * uy; // 朝該 body 前進的分量（dot）
    if (approach <= 0) continue; // 遠離 → 切向不夾
    const contactDist = self.radius + body.radius - params.contactSlop;
    const free = Math.max(0, dist - contactDist); // 還能自由走的距離
    if (free >= approach) continue; // 本幀走不到接觸 → 不夾
    let shareFraction: number;
    if (body.canBePushed) {
      const sum = self.mass + body.mass;
      shareFraction = sum > 0 ? self.mass / sum : 0.5;
    } else {
      shareFraction = 0; // 對手無限質量 → 完全推不動
    }
    const allowed = free + (approach - free) * shareFraction;
    const cut = approach - allowed; // 超出份額的接近分量
    mx -= ux * cut;
    my -= uy * cut;
    if (body.canBePushed) pairs.push(pushPairKey(self.id, body.id));
  }
  return { move: { x: mx, y: my }, pushPairs: pairs };
}

/**
 * 接線用純適配器：把 EnemySpawner 現有的 overlapAgent（{x,y,radius,movable}＋穩定 id）陣列
 * 轉成 ContactBody[]，供 solveContacts 消費。
 *
 * 對應蟲騎避雷[4]：
 *  - mass = 體型半徑（大怪重、小怪輕）；radius<=0（grabber/dead 已被呼叫端標記跳過）→ mass 也 0。
 *  - canBePushed = movable（immovable/蓄力菁英 movable=false → 無限質量、只推別人不被推）。
 * id 用怪的穩定 id（Enemy.id）字串化，跨幀不變（防 rebuild/reorder 破 pushPairs key）。
 */
export interface OverlapAgentWithId {
  id: string;
  x: number;
  y: number;
  radius: number;
  movable: boolean;
}

export function overlapAgentsToContactBodies(agents: readonly OverlapAgentWithId[]): ContactBody[] {
  return agents.map((a) => ({
    id: a.id,
    x: a.x,
    y: a.y,
    radius: a.radius,
    mass: a.radius, // 質量＝體型（半徑）；radius 0（跳過者）→ mass 0
    canBePushed: a.movable,
  }));
}
