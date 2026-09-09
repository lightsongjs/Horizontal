import {
  ArrowLeft,
  Crosshair,
  Star,
  Clock,
  Copy,
  ArrowUp,
  Camera,
  CircleQuestionMark,
  Eye,
  EyeOff,
  LogOut,
  Moon,
  PanelLeft,
  RefreshCw,
  Settings,
  Share2,
  Square,
  SquareCheck,
  Sun,
  Users,
  CalendarDays,
  FileArchive,
  FileCode,
  FileText,
  Film,
  Image,
  Music,
  Paperclip,
  Pencil,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CornerDownRight,
  ExternalLink,
  GripVertical,
  LayoutGrid,
  LoaderCircle,
  NotepadText,
  Plus,
  RotateCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react'

/**
 * Vocabularul de iconițe al aplicației.
 *
 * Înainte erau glife și emoji puse direct în JSX (`★ ▤ ⊞ ⚡ ⚙ 🗑 📝 ◔ ⠿`). Trei
 * probleme, în ordinea gravității: emoji-ul se randează cu paleta sistemului,
 * deci nu se poate colora și arată altfel pe fiecare telefon; glifele
 * tipografice cad pe fonturi diferite, deci n-au grosime de linie comună; iar
 * împreună sunt primul semn că ecranul n-a fost desenat de nimeni.
 *
 * **De ce SVG inline și nu fontul Material Symbols.** Aplicația e un PWA
 * offline-first. Un font de iconițe luat de la Google ar da pătrate de tofu
 * exact când omul e în metrou — iar unul găzduit local ar intra în manifestul de
 * precache al service workerului, adică în contractul de update din `pwa.ts`.
 * `lucide-react` intră în bundle, se scutură la build (numai iconițele de mai
 * jos) și e desenat pe grilă de 24px cu o singură grosime de linie.
 *
 * Numele sunt ale rolului din aplicație, nu ale desenului: `urgent`, nu `zap`.
 * Așa se schimbă desenul o singură dată, aici.
 */
const ICONS = {
  add: Plus,
  arrowUp: ArrowUp,
  attachment: Paperclip,
  back: ArrowLeft,
  bell: Bell,
  close: X,
  copy: Copy,
  collapse: ChevronDown,
  danger: TriangleAlert,
  delete: Trash2,
  dep: CornerDownRight,
  done: CircleCheck,
  drag: GripVertical,
  camera: Camera,
  edit: Pencil,
  expand: ChevronRight,
  external: ExternalLink,
  fileArchive: FileArchive,
  fileAudio: Music,
  fileCode: FileCode,
  fileDoc: FileText,
  fileImage: Image,
  fileVideo: Film,
  graph: Share2,
  help: CircleQuestionMark,
  hide: EyeOff,
  image: Image,
  logout: LogOut,
  members: Users,
  refresh: RefreshCw,
  selectAll: SquareCheck,
  selector: Crosshair,
  selectNone: Square,
  show: Eye,
  star: Star,
  sidebar: PanelLeft,
  fromTitle: Sparkles,
  list: CalendarRange,
  loading: LoaderCircle,
  notDone: Circle,
  projects: LayoutGrid,
  recurring: RotateCw,
  reminder: Bell,
  reminderTime: Clock,
  scratch: NotepadText,
  search: Search,
  settings: Settings2,
  settingsProject: Settings,
  check: Check,
  checkAll: CheckCheck,
  themeDark: Moon,
  themeLight: Sun,
  today: CalendarDays,
  tomorrow: CalendarClock,
  due: CalendarCheck,
  urgent: Zap,
} as const

export type IconName = keyof typeof ICONS

interface Props {
  name: IconName
  /** Latura, în px. Implicit 18 — potrivit lângă un rând de text de 15px. */
  size?: number
  className?: string
  /** Pus doar când iconița e singura etichetă a controlului. */
  label?: string
}

/**
 * O iconiță. Moștenește `currentColor`, deci se colorează din CSS ca și textul
 * pe care îl însoțește.
 *
 * Grosimea de linie e fixată aici, nu lăsată pe implicitul librăriei: două
 * iconițe de grosimi diferite în același rând se văd imediat.
 */
export function Icon({ name, size = 18, className, label }: Props) {
  const Glyph = ICONS[name]
  return (
    <Glyph
      size={size}
      strokeWidth={1.75}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  )
}
