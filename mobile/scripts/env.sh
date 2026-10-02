# Toolchain-ul cutiei Android. `source mobile/scripts/env.sh` înainte de orice gradle/adb.
# JDK 21, nu 25-ul sistemului: AGP nu-l suportă încă.
export JAVA_HOME="$HOME/.local/opt/jdk-21"
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
