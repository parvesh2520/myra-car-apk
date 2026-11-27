// JNI bridge for the car's command LLM: load a GGUF, greedy-decode one short answer, free.
// Greedy argmax over the logits (the model is fine-tuned to answer in JSON), no sampler chain.
#include <jni.h>
#include <android/log.h>
#include <string>
#include <vector>
#include <chrono>
#include "llama.h"

#define TAG "myrallm"

namespace {
struct Llm {
    llama_model *model;
    llama_context *ctx;
    const llama_vocab *vocab;
};

void log_cb(ggml_log_level level, const char *text, void *) {
    if (level >= GGML_LOG_LEVEL_WARN) __android_log_write(ANDROID_LOG_WARN, TAG, text);
}

jstring utf8(JNIEnv *env, const std::string &s) {
    // NewStringUTF wants modified UTF-8; go through a byte array so any UTF-8 the model writes is safe.
    jbyteArray bytes = env->NewByteArray((jsize) s.size());
    env->SetByteArrayRegion(bytes, 0, (jsize) s.size(), (const jbyte *) s.data());
    jclass cls = env->FindClass("java/lang/String");
    jmethodID ctor = env->GetMethodID(cls, "<init>", "([BLjava/lang/String;)V");
    return (jstring) env->NewObject(cls, ctor, bytes, env->NewStringUTF("UTF-8"));
}
}  // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_myra_car_Llm_nativeLoad(JNIEnv *env, jclass, jstring jpath, jint threads, jint n_ctx) {
    llama_log_set(log_cb, nullptr);
    llama_backend_init();
    const char *path = env->GetStringUTFChars(jpath, nullptr);
    llama_model_params mp = llama_model_default_params();
    mp.load_mode = LLAMA_LOAD_MODE_MMAP;  // weights stay file-backed pages the OS can drop, not app heap
    llama_model *model = llama_model_load_from_file(path, mp);
    env->ReleaseStringUTFChars(jpath, path);
    if (!model) return 0;
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = n_ctx;
    cp.n_batch = n_ctx;
    cp.n_ubatch = n_ctx;
    cp.n_threads = threads;
    cp.n_threads_batch = threads;
    llama_context *ctx = llama_init_from_model(model, cp);
    if (!ctx) { llama_model_free(model); return 0; }
    return (jlong) new Llm{model, ctx, llama_model_get_vocab(model)};
}

// Returns the generated text (special tokens dropped), stopping at end-of-generation or maxTokens.
// timing[0] = prompt tokens, [1] = generated tokens, [2] = prompt ms, [3] = generation ms.
extern "C" JNIEXPORT jstring JNICALL
Java_com_myra_car_Llm_nativeGenerate(JNIEnv *env, jclass, jlong handle, jstring jprompt, jint max_tokens, jlongArray jtiming) {
    auto *llm = (Llm *) handle;
    const char *p = env->GetStringUTFChars(jprompt, nullptr);
    std::string prompt(p);
    env->ReleaseStringUTFChars(jprompt, p);

    std::vector<llama_token> tokens(prompt.size() + 8);
    int n = llama_tokenize(llm->vocab, prompt.c_str(), (int32_t) prompt.size(), tokens.data(), (int32_t) tokens.size(), false, true);
    if (n < 0) return nullptr;
    tokens.resize(n);
    if (n + max_tokens > (int) llama_n_ctx(llm->ctx)) return nullptr;

    llama_memory_clear(llama_get_memory(llm->ctx), true);
    auto now = [] { return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); };
    long long t0 = now();
    if (llama_decode(llm->ctx, llama_batch_get_one(tokens.data(), n)) != 0) return nullptr;
    long long t1 = now();

    const int n_vocab = llama_vocab_n_tokens(llm->vocab);
    std::string out;
    int generated = 0;
    for (; generated < max_tokens; generated++) {
        const float *logits = llama_get_logits_ith(llm->ctx, -1);
        llama_token best = 0;
        for (int i = 1; i < n_vocab; i++) if (logits[i] > logits[best]) best = i;
        if (llama_vocab_is_eog(llm->vocab, best)) break;
        char buf[256];
        int len = llama_token_to_piece(llm->vocab, best, buf, sizeof(buf), 0, false);
        if (len > 0) out.append(buf, len);
        if (llama_decode(llm->ctx, llama_batch_get_one(&best, 1)) != 0) return nullptr;
    }
    long long t2 = now();
    jlong timing[4] = {n, generated, t1 - t0, t2 - t1};
    env->SetLongArrayRegion(jtiming, 0, 4, timing);
    return utf8(env, out);
}

extern "C" JNIEXPORT void JNICALL
Java_com_myra_car_Llm_nativeFree(JNIEnv *, jclass, jlong handle) {
    auto *llm = (Llm *) handle;
    llama_free(llm->ctx);
    llama_model_free(llm->model);
    delete llm;
}
