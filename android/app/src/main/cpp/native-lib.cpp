// JNI-Brücke: startet Node.js (nodejs-mobile) im App-Prozess und leitet die
// Konsolenausgabe ins Android-Log (logcat, Tag "VideoLauncherNode") um.
#include <jni.h>
#include <string>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>

#include "node.h"

static const char *LOG_TAG = "VideoLauncherNode";
static int pipe_stdout[2];
static int pipe_stderr[2];
static FILE *log_file = nullptr;
static pthread_mutex_t log_mutex = PTHREAD_MUTEX_INITIALIZER;

static void *log_thread(void *arg) {
    int fd = *static_cast<int *>(arg);
    int prio = fd == pipe_stderr[0] ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO;
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof buf - 1)) > 0) {
        if (buf[n - 1] == '\n') --n;
        buf[n] = 0;
        __android_log_write(prio, LOG_TAG, buf);
        // Zusätzlich in eine Datei, damit die App Fehler anzeigen kann.
        if (log_file) {
            pthread_mutex_lock(&log_mutex);
            fprintf(log_file, "%s\n", buf);
            fflush(log_file);
            pthread_mutex_unlock(&log_mutex);
        }
    }
    return nullptr;
}

static void redirect_output() {
    const char *path = getenv("VL_LOG_FILE");
    if (path) log_file = fopen(path, "a");
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pipe_stdout) == 0) dup2(pipe_stdout[1], STDOUT_FILENO);
    if (pipe(pipe_stderr) == 0) dup2(pipe_stderr[1], STDERR_FILENO);
    pthread_t t1, t2;
    if (pthread_create(&t1, nullptr, log_thread, &pipe_stdout[0]) == 0) pthread_detach(t1);
    if (pthread_create(&t2, nullptr, log_thread, &pipe_stderr[0]) == 0) pthread_detach(t2);
}

extern "C" JNIEXPORT jint JNICALL
Java_de_videolauncher_app_NodeBridge_startNodeWithArguments(JNIEnv *env, jclass, jobjectArray arguments) {
    jsize argc = env->GetArrayLength(arguments);

    // libuv erwartet alle Argumente in einem zusammenhängenden Speicherbereich.
    std::vector<std::string> args;
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        auto js = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *s = env->GetStringUTFChars(js, nullptr);
        args.emplace_back(s);
        total += strlen(s) + 1;
        env->ReleaseStringUTFChars(js, s);
        env->DeleteLocalRef(js);
    }
    char *buffer = (char *) calloc(total, sizeof(char));
    std::vector<char *> argv(argc);
    char *pos = buffer;
    for (jsize i = 0; i < argc; i++) {
        memcpy(pos, args[i].c_str(), args[i].size());
        argv[i] = pos;
        pos += args[i].size() + 1;
    }

    redirect_output();
    return jint(node::Start(argc, argv.data()));
}
