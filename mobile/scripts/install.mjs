// Construiește APK-ul release și îl instalează pe dispozitivul conectat prin adb.
// `-r` păstrează datele (sesiunea, coada): merge doar cu ACEEAȘI cheie de semnare.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })
if (!existsSync(`${homedir()}/.local/share/horizontal/android-release.jks`)) {
  console.error('Lipsește cheia de semnare (~/.local/share/horizontal/android-release.jks). Vezi CLAUDE.md, „Aplicația de Android".')
  process.exit(1)
}
run('npx', ['cap', 'sync', 'android'], { cwd: new URL('..', import.meta.url).pathname })
run('./gradlew', ['--quiet', 'assembleRelease'], { cwd: new URL('../android', import.meta.url).pathname })
const devices = execFileSync('adb', ['devices'], { encoding: 'utf8' }).split('\n').slice(1).filter((l) => /\tdevice$/.test(l))
// Cu mai multe dispozitive, ANDROID_SERIAL alege ținta: fără el adb ar refuza, iar noi nu ghicim pe care să scriem.
const serial = process.env.ANDROID_SERIAL
if (devices.length !== 1 && !serial) {
  console.error(`Am nevoie de exact un dispozitiv conectat (găsite: ${devices.length}). Folosește ANDROID_SERIAL.`)
  process.exit(1)
}
const target = serial ? ['-s', serial] : []
run('adb', [...target, 'install', '-r', new URL('../android/app/build/outputs/apk/release/app-release.apk', import.meta.url).pathname])
