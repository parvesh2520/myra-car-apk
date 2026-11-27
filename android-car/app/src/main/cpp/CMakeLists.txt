cmake_minimum_required(VERSION 3.22)
project(myrallm C CXX)

# llama.cpp source tree (gradle property llamaDir, default C:/m/llama.cpp). Built static into one JNI library.
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE) # ggml's own thread pool; no libomp to ship
if(ANDROID_ABI STREQUAL "armeabi-v7a")
    set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE) # its sgemm needs fp16 NEON loads that 32-bit ARM lacks
endif()
add_subdirectory(${LLAMA_DIR} llama)

add_library(myrallm SHARED llm.cpp)
target_link_libraries(myrallm llama log)
