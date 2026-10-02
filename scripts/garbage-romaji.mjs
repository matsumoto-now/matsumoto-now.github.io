/** Hepburn readings for the waste calendar's district and 町会 names.
 *
 *  Neither the city PDFs nor any open address dataset carries readings for
 *  Matsumoto's 町会, so they are hand-kept here, like the bus line names in
 *  fetch-bus-data.mjs. Numbered and directional variants are derived rather
 *  than listed: 中条東第１ = 中条 + 東 + 第１ → "Chūjō-higashi 1". A name that
 *  cannot be built from the table gets null and shows in Japanese only. */

export const DISTRICT_ROMAJI = {
  第一: 'Daiichi', 第二: 'Daini', 第三: 'Daisan', 東部: 'Tōbu', 中央A: 'Chūō A', 中央B: 'Chūō B',
  城北: 'Jōhoku', 安原: 'Yasuhara', 城東: 'Jōtō', 白板: 'Shiraita', 田川: 'Tagawa',
  庄内A: 'Shōnai A', 庄内B: 'Shōnai B', 鎌田: 'Kamada', 松南: 'Shōnan',
  島内A: 'Shimauchi A', 島内B: 'Shimauchi B', 中山: 'Nakayama', 島立: 'Shimadachi',
  新村: 'Niimura', 和田: 'Wada', 神林: 'Kanbayashi', 笹賀: 'Sasaga', 芳川: 'Yoshikawa',
  寿: 'Kotobuki', 寿台: 'Kotobukidai', 松原: 'Matsubara', 岡田: 'Okada',
  入山辺: 'Iriyamabe', 里山辺: 'Satoyamabe', 今井: 'Imai', 内田: 'Uchida',
  本郷A1: 'Hongō A1', 本郷A2: 'Hongō A2', 本郷B: 'Hongō B', 四賀: 'Shiga',
  梓川: 'Azusagawa', 波田1班: 'Hata 1', 波田2班: 'Hata 2', 奈川: 'Nagawa', 安曇: 'Azumi',
};

const PLACES = {
  // 第一・第二・第三
  本町: 'Honmachi', 伊勢町: 'Isemachi', 分銅町: 'Fundōmachi', 新伊勢町: 'Shin-Isemachi',
  神明町: 'Shinmeichō', 国府町: 'Kokufumachi', 西五町: 'Nishigochō', 長沢町: 'Nagasawamachi',
  中条: 'Chūjō', 博労町: 'Bakurōmachi', 中町: 'Nakamachi', 源地: 'Genchi', 源池: 'Genchi',
  梅ヶ枝町: 'Umegaechō', 錦町: 'Nishikimachi', 栄町: 'Sakaemachi', 常盤町: 'Tokiwamachi',
  向島: 'Mukaijima', 宮村町: 'Miyamurachō', 天神南小池町: 'Tenjin-Minami-Koikemachi',
  飯田町: 'Iidamachi', 小池町: 'Koikemachi', 埋橋: 'Uzuhashi', 若松町: 'Wakamatsuchō',
  県町: 'Agatamachi', 四ツ谷町: 'Yotsuyachō', 四ツ谷: 'Yotsuya', 金山町: 'Kanayamachō',
  日の出町: 'Hinodechō', 幸町: 'Saiwaichō',
  // 東部・中央・城北・安原・城東
  清水: 'Shimizu', 片端町: 'Katahamachi', 出居番町: 'Deibanchō', 東町: 'Higashimachi',
  鍛冶町: 'Kajimachi', 餌差町: 'Esashimachi', 桜町: 'Sakuramachi', 横田町: 'Yokotachō',
  上横田町: 'Kamiyokotachō', 葭町: 'Yoshimachi', 小柳町: 'Koyanagichō', 二ノ丸町: 'Ninomaruchō',
  西堀町: 'Nishiborichō', 今町: 'Imamachi', 鷹匠町: 'Takajōmachi', 丸の内: 'Marunouchi',
  土井尻町: 'Doijirimachi', 大柳町: 'Ōyanagichō', 松栄町: 'Shōeichō', 緑町: 'Midorichō',
  大名町: 'Daimyōchō', 六九町: 'Rokkumachi', 上土町: 'Agetsuchimachi', 蟻ヶ崎: 'Arigasaki',
  蟻ヶ崎台: 'Arigasakidai', 蟻ヶ崎深志ヶ丘: 'Arigasaki-Fukashigaoka', 田町: 'Tamachi',
  新田町: 'Shindenmachi', 馬場: 'Baba', 沢村: 'Sawamura', 白金町: 'Shiroganechō',
  徒士町: 'Kachimachi', 旗町: 'Hatamachi', 西町: 'Nishimachi', 堂町: 'Dōmachi',
  同心口張: 'Dōshin-Kuchibari', 旭町: 'Asahimachi', 元原: 'Motohara', 中原: 'Nakahara',
  両下町: 'Ryōgemachi', 袋町: 'Fukuromachi', 萩町: 'Hagimachi', 安原町: 'Yasuharamachi',
  新町: 'Shinmachi', 天白三: 'Tenpaku 3', 和泉町: 'Izumichō', 女鳥羽町: 'Metobachō',
  元町: 'Motomachi', 元町南区: 'Motomachi Minami-ku', 岡の宮: 'Okanomiya',
  岡の宮文園町: 'Okanomiya-Bun’enchō', 曙町: 'Akebonochō',
  // 白板・田川・庄内・鎌田・松南
  巴町: 'Tomoemachi', 折井町: 'Oriichō', 白板: 'Shiraita', 宮本: 'Miyamoto', 宮渕: 'Miyabuchi',
  宮渕日向: 'Miyabuchi-Hinata', 宮渕新橋: 'Miyabuchi-Shinbashi', 宮渕本村: 'Miyabuchi-Honmura',
  白板宮本: 'Shiraita-Miyamoto', 放光寺: 'Hōkōji', 宮崎町: 'Miyazakichō', 駒町: 'Komamachi',
  城西町: 'Jōseichō', 巾上: 'Habaue', 巾上町: 'Habauechō', 渚: 'Nagisa', 渚町: 'Nagisachō',
  渚本郷: 'Nagisa-Hongō', 渚内城: 'Nagisa-Uchijiro', 渚宮本: 'Nagisa-Miyamoto',
  渚本村: 'Nagisa-Honmura', 庄内町: 'Shōnaimachi', 逢初町: 'Aisomechō', 新家町: 'Shinkemachi',
  豊田町: 'Toyodamachi', 神田: 'Kanda', 三才: 'Sansai', 筑摩: 'Tsukama', 中林: 'Nakabayashi',
  出川町: 'Degawamachi', 並柳: 'Namiyanagi', 並柳団地: 'Namiyanagi Danchi',
  中条町: 'Chūjōmachi', 井川城: 'Igawajō', 井川城上区: 'Igawajō Kami-ku',
  井川城中区: 'Igawajō Naka-ku', 井川城下区: 'Igawajō Shimo-ku', 鎌田: 'Kamada',
  両島: 'Ryōshima', 笹部: 'Sasabe', 征矢野: 'Soyano', 高宮: 'Takamiya', 石芝: 'Ishishiba',
  昭和町: 'Shōwamachi', 月見町: 'Tsukimichō', 五月町: 'Satsukimachi', 南原町: 'Minamiharachō',
  弥生町: 'Yayoichō', 松本: 'Matsumoto', 双葉町: 'Futabachō', 双葉: 'Futaba', 宮田: 'Miyata',
  芳野町: 'Yoshinochō',
  // 島内・中山・島立・新村・和田・神林・笹賀・芳川
  小宮: 'Komiya', 高松: 'Takamatsu', 南中: 'Minaminaka', 青島: 'Aoshima', 松島: 'Matsushima',
  新橋: 'Shinbashi', 中田: 'Nakata', ウッドタウン小宮: 'Wood Town Komiya',
  島高松: 'Shima-Takamatsu', 北中: 'Kitanaka', 東方: 'Higashikata', 町: 'Machi',
  北方: 'Kitakata', 平瀬: 'Hirase', 平瀬川西: 'Hirase-Kawanishi', 平瀬川東: 'Hirase-Kawahigashi',
  下田: 'Shimoda', 山田: 'Yamada', 犬飼新田: 'Inukai-Shinden', 和泉: 'Izumi', 埴原: 'Haibara',
  棚峯: 'Tanamine', 荒井: 'Arai', 堀米: 'Horigome', 大庭: 'Ōba', 小柴: 'Koshiba',
  町区: 'Machi-ku', 永田: 'Nagata', 中村: 'Nakamura', 三の宮: 'Sannomiya', 栗: 'Kuri',
  上新: 'Kamishin', 根石: 'Neishi', 安塚: 'Yasuzuka', 山王: 'Sannō', 南新: 'Minamishin',
  東新: 'Higashishin', 北新: 'Kitashin', 下新: 'Shimoshin', 蘇我: 'Soga', 衣外: 'Kinuso',
  殿: 'Tono', 和田: 'Wada', 太子堂: 'Taishidō', 中: 'Naka', 和田町: 'Wadamachi', 境: 'Sakai',
  西原: 'Nishihara', 川西: 'Kawanishi', 川東: 'Kawahigashi', 寺家: 'Jike', 町神: 'Machigami',
  下神: 'Shimogami', 梶海渡: 'Kajikaido', 今: 'Ima', 小俣: 'Komata', 巾下: 'Habashita',
  耕地: 'Kōchi', 神戸新田: 'Gōdo-Shinden', 神戸: 'Gōdo', 二子: 'Futago', 菅野: 'Sugano',
  二美町: 'Futamichō', 空港: 'Kūkō', 村井町: 'Muraimachi', 小屋: 'Koya', 野溝: 'Nomizo',
  平田: 'Hirata', 美芳町: 'Mihochō', 長丘町: 'Nagaokachō', 北原町: 'Kitaharachō', 木工: 'Mokkō',
  // 寿・松原・岡田・入山辺・里山辺・今井・内田・本郷
  赤木: 'Akagi', 小池: 'Koike', 百瀬: 'Momose', 白川: 'Shirakawa', 白姫: 'Shirahime',
  瀬黒: 'Seguro', 竹渕: 'Takebuchi', 豊町: 'Yutakamachi', 寿田町: 'Kotobukidamachi',
  竹原町: 'Takeharachō', 寿田川: 'Kotobukidagawa', 寿台: 'Kotobukidai', 松原: 'Matsubara',
  伊深: 'Ibuka', 岡田町: 'Okadamachi', 東区: 'Higashi-ku', 塩倉: 'Shiokura', 神沢: 'Kanzawa',
  松岡: 'Matsuoka', 山浦: 'Yamaura', 橋倉: 'Hashikura', 南方: 'Minamikata', 桐原: 'Kirihara',
  舟付: 'Funatsuki', 宮原: 'Miyahara', 北入中部: 'Kitairi-Chūbu', 千手: 'Senju',
  駒越: 'Komagoe', 三反田: 'Sandanda', 奈良尾: 'Narao', 上手町: 'Kamitemachi', 原: 'Hara',
  厩所: 'Mayasho', 大仏: 'Daibutsu', 一の海: 'Ichinoumi', 金井: 'Kanai', 新井: 'Arai',
  湯の原: 'Yunohara', 藤井: 'Fujii', 薄町: 'Susukimachi', 兎川寺: 'Tosenji', 荒町: 'Aramachi',
  小松: 'Komatsu', 林: 'Hayashi', 美里町: 'Misatochō', 若里町: 'Wakasatochō',
  小松町: 'Komatsumachi', 新田: 'Shinden', 堂村: 'Dōmura', 中沢: 'Nakazawa',
  境新田: 'Sakai-Shinden', 野口: 'Noguchi', 古池: 'Furuike', 今井: 'Imai', 公園: 'Kōen',
  内田: 'Uchida', 浅間: 'Asama', 大村: 'Ōmura', 惣社: 'Sōja', 横田: 'Yokota', 水汲: 'Mizukumi',
  三才山: 'Misayama', 稲倉: 'Inagura', 洞: 'Hora',
  // 四賀・梓川
  反町: 'Sorimachi', 刈谷原町: 'Karigaharamachi', 七嵐: 'Nanaarashi', 赤怒田: 'Akanuta',
  殿野入: 'Tononiri', 保福寺町: 'Hofukujimachi', 小岩井: 'Koiwai', 両瀬: 'Ryōse',
  原山: 'Harayama', 横川: 'Yokokawa', 会吉: 'Aiyoshi', 矢久: 'Yakyū', 召田: 'Meshida',
  長越: 'Nagakoshi', 藤池: 'Fujiike', 穴沢: 'Anazawa', 取出: 'Toride', 板場: 'Itaba',
  岩井堂: 'Iwaidō', 西宮: 'Nishimiya', 落水: 'Ochimizu', 井刈: 'Ikari', 執田光: 'Shūdenkō',
  八景山: 'Yakageyama', 花見: 'Hanami', 上野: 'Ueno', 丸田: 'Maruta', 立田: 'Tatsuta',
  杏: 'Anzu', こまち: 'Komachi', 角影台: 'Kakukagedai', 角: 'Kado', 小室: 'Komuro',
  北々条: 'Kitakitajō', 南北条: 'Minamihōjō', 大久保: 'Ōkubo', 大妻: 'Ōtsuma',
  横沢: 'Yokozawa', 氷室: 'Himuro', 岩岡: 'Iwaoka',
};

/** Leading direction/position: 南浅間 → "Minami-Asama". */
const PREFIX = { 東: 'Higashi', 西: 'Nishi', 南: 'Minami', 北: 'Kita', 上: 'Kami', 下: 'Shimo', 中: 'Naka' };
/** Trailing one: 清水東 → "Shimizu-higashi". */
const SUFFIX = { 東: 'higashi', 西: 'nishi', 南: 'minami', 北: 'kita', 中: 'naka', 上: 'kami' };

function base(name) {
  if (PLACES[name]) return PLACES[name];
  const head = name[0];
  const tail = name.at(-1);
  if (name.length > 1 && SUFFIX[tail]) {
    const r = base(name.slice(0, -1));
    if (r) return `${r}-${SUFFIX[tail]}`;
  }
  if (name.length > 1 && PREFIX[head]) {
    const r = base(name.slice(1));
    if (r) return `${PREFIX[head]}-${r}`;
  }
  return null;
}

/** Romaji for one 町会 name as it appears in garbage.json, or null. */
export function chokaiRomaji(raw) {
  const name = raw.normalize('NFKC').trim();
  let m;
  if ((m = name.match(/^(\d+)区$/))) return `${m[1]}-ku`; // 波田
  if ((m = name.match(/^(.+?)(\d+)丁目$/))) {
    const r = base(m[1]);
    return r && `${r} ${m[2]}-chōme`;
  }
  if ((m = name.match(/^(.+?)第(\d+)$/))) {
    const r = base(m[1]);
    return r && `${r} ${m[2]}`;
  }
  if (name.includes('・')) {
    const parts = name.split('・').map(base);
    return parts.every(Boolean) ? parts.join(' / ') : null;
  }
  return base(name);
}
