/* Test-only inclusion gives access to pure parsers; no seams in the shipped binary. */
#define _GNU_SOURCE
#include <stdio.h>
#include <sys/ioctl.h>
#include <sys/statfs.h>
#include <stdarg.h>
static int probe_ioctl(int fd, unsigned long request, ...);
static int probe_statfs(int fd, struct statfs *fs);
static FILE *probe_fopen(const char *path, const char *mode);
#define ioctl probe_ioctl
#define fstatfs probe_statfs
#define fopen probe_fopen
#define main gate_main
#include "../infrastructure/casaos/postgres-hdd-entrypoint.c"
#undef main
#undef ioctl
#undef fstatfs
#undef fopen
#include <assert.h>

static int ioctl_failure, fs_failure, mount_failure;
static uint32_t returned_length = 16, returned_flags;
static unsigned char returned_uuid[16];
static char mount_text[512];
static int probe_ioctl(int fd, unsigned long request, ...) {
    assert(fd >= 0 && request == GETFSUUID);
    va_list ap;
    va_start(ap, request);
    struct uuid_payload *payload = va_arg(ap, struct uuid_payload *);
    va_end(ap);
    assert(payload->header.len == 16 && payload->header.flags == 0);
    if (ioctl_failure) { errno = EPERM; return -1; }
    payload->header.len = returned_length;
    payload->header.flags = returned_flags;
    memcpy(payload->bytes, returned_uuid, 16);
    return 0;
}
static int probe_statfs(int fd, struct statfs *fs) {
    assert(fd >= 0);
    memset(fs, 0, sizeof(*fs));
    fs->f_type = fs_failure ? 0x01021994 : EXT4_MAGIC;
    return 0;
}
static FILE *probe_fopen(const char *path, const char *mode) {
    assert(!strcmp(path, "/proc/self/mountinfo") && !strcmp(mode, "re"));
    return mount_failure ? NULL : fmemopen(mount_text, strlen(mount_text), "r");
}

static int mount_case(const char *text, const char *root, dev_t dev) {
    FILE *fp = fmemopen((void *)text, strlen(text), "r");
    assert(fp);
    int result = mount_matches(fp, root, dev);
    fclose(fp);
    return result;
}

int main(void) {
    unsigned char uuid[16];
    assert(uuid_parse("11111111-2222-3333-4444-555555555555", uuid));
    assert(uuid[0] == 0x11 && uuid[15] == 0x55);
    assert(!uuid_parse("11111111-2222-3333-4444-AAAAAAAAAAAA", uuid));
    assert(!uuid_parse("11111111-2222-3333-4444-555555555555x", uuid));
    assert(!uuid_parse(NULL, uuid));
    assert(normal_path("/space here/coffee"));
    const char *bad[] = {"", "/", "relative", "/a/", "/a//b", "/a/./b", "/a/../b", "/a\nb"};
    for (size_t i = 0; i < sizeof(bad) / sizeof(*bad); i++) assert(!normal_path(bad[i]));
    const char *good = "45 1 8:17 /owned\\040fixture/data /var/lib/postgresql/data rw,nosuid - ext4 /dev/loop0 rw\n";
    assert(mount_case(good, "/owned fixture/data", makedev(8, 17)));
    assert(!mount_case(good, "/other/data", makedev(8, 17)));
    assert(!mount_case(good, "/owned fixture/data", makedev(8, 18)));
    assert(!mount_case("45 1 8:17 /data /var/lib/postgresql/data rw - tmpfs tmpfs rw\n", "/data", makedev(8, 17)));
    assert(!mount_case("45 1 8:17 /data /var/lib/postgresql/data rw - ext4 /dev/x rw\n46 1 8:17 /data /var/lib/postgresql/data rw - ext4 /dev/x rw\n", "/data", makedev(8, 17)));
    assert(!mount_case("45 1 8:17 /data /var/lib/postgresql/data rw - ext4 /dev/x rw\n46 45 8:17 /else /var/lib/postgresql/data/pgdata rw - ext4 /dev/x rw\n", "/data", makedev(8, 17)));
    assert(!mount_case("45 1 8:17 /data\\000evil /var/lib/postgresql/data rw - ext4 /dev/x rw\n", "/data", makedev(8, 17)));
    assert(!mount_case("45 1 8:17 /data /var/lib/postgresql/data rw - ext4 /dev/x rw", "/data", makedev(8, 17)));
    assert(!mount_case("garbage\n", "/data", makedev(8, 17)));
    assert(!mount_case("", "/data", makedev(8, 17)));
    /* Test-only syscall substitution checks malformed/unsupported evidence;
     * hosted containers separately exercise real kernel UUID/seccomp paths. */
    int fd = open(".", O_RDONLY | O_DIRECTORY);
    struct stat st;
    assert(fd >= 0 && !fstat(fd, &st));
    assert(uuid_parse("11111111-2222-3333-4444-555555555555", returned_uuid));
    memcpy(uuid, returned_uuid, 16);
    assert(snprintf(mount_text, sizeof(mount_text),
        "45 1 %u:%u /data /var/lib/postgresql/data rw - ext4 /dev/x rw\n",
        major(st.st_dev), minor(st.st_dev)) > 0);
    assert(kernel_matches(fd, uuid, "/data"));
    ioctl_failure = 1;
    assert(!kernel_matches(fd, uuid, "/data"));
    ioctl_failure = 0;
    returned_length = 15;
    assert(!kernel_matches(fd, uuid, "/data"));
    returned_length = 17;
    assert(!kernel_matches(fd, uuid, "/data"));
    returned_length = 16;
    returned_flags = 1;
    assert(!kernel_matches(fd, uuid, "/data"));
    returned_flags = 0;
    returned_uuid[15] ^= 1;
    assert(!kernel_matches(fd, uuid, "/data"));
    returned_uuid[15] ^= 1;
    fs_failure = 1;
    assert(!kernel_matches(fd, uuid, "/data"));
    fs_failure = 0;
    mount_failure = 1;
    assert(!kernel_matches(fd, uuid, "/data"));
    mount_failure = 0;
    assert(kernel_matches(fd, uuid, "/data"));
    close(fd);
    puts("PASS strict UUID/path and escaped exact mount/root/device/ambiguity parsers");
    return 0;
}
