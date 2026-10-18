/* Linux-only app-local admission. No writes, secret reads, subprocess probes or
 * configurable executable. Kernel ABI: include/uapi/linux/ext4.h, GETFSUUID (44).
 * All checks are repeated for each invocation; no receipt/cache/test bypass. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/sysmacros.h>
#include <unistd.h>

#define DATA "/var/lib/postgresql/data"
#define PGDATA_PATH DATA "/pgdata"
#define EXT4_MAGIC 0xef53
/* The ioctl number encodes the 8-byte flexible-array HEADER, not the payload. */
struct uuid_header { uint32_t len, flags; };
struct uuid_payload { struct uuid_header header; unsigned char bytes[16]; };
#define GETFSUUID _IOR('f', 44, struct uuid_header)

static int refuse(void) {
    fputs("CupMemo PostgreSQL: storage admission refused\n", stderr);
    return 1;
}

static int normal_path(const char *s) {
    if (!s || s[0] != '/' || !s[1] || strlen(s) >= PATH_MAX) return 0;
    const char *part = s + 1;
    for (const char *p = part;; p++) {
        unsigned char ch = (unsigned char)*p;
        if (ch && (ch < 32 || ch == 127)) return 0;
        if (!ch || ch == '/') {
            size_t n = (size_t)(p - part);
            if (!n || (n == 1 && part[0] == '.') ||
                (n == 2 && part[0] == '.' && part[1] == '.')) return 0;
            if (!ch) return 1;
            part = p + 1;
        }
    }
}

static int hex(char ch) {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
    return -1;
}

static int uuid_parse(const char *s, unsigned char out[16]) {
    if (!s || strlen(s) != 36) return 0;
    size_t j = 0;
    for (size_t i = 0; i < 36;) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (s[i++] != '-') return 0;
        } else {
            int a = hex(s[i++]), b = hex(s[i++]);
            if (a < 0 || b < 0) return 0;
            out[j++] = (unsigned char)((a << 4) | b);
        }
    }
    return j == 16;
}

static int decimal(const char *s, unsigned long *out) {
    if (!s || !*s) return 0;
    unsigned long n = 0;
    for (; *s; s++) {
        if (*s < '0' || *s > '9' || n > (UINT32_MAX - (unsigned)(*s - '0')) / 10)
            return 0;
        n = n * 10 + (unsigned)(*s - '0');
    }
    *out = n;
    return 1;
}

/* mountinfo escapes space, tab, newline and backslash, not arbitrary octal. */
static int unescape(char *s) {
    char *out = s;
    for (char *p = s; *p; p++) {
        if (*p != '\\') *out++ = *p;
        else {
            if (strlen(p) < 4) return 0;
            if (!strncmp(p, "\\040", 4)) *out++ = ' ';
            else if (!strncmp(p, "\\011", 4)) *out++ = '\t';
            else if (!strncmp(p, "\\012", 4)) *out++ = '\n';
            else if (!strncmp(p, "\\134", 4)) *out++ = '\\';
            else return 0;
            p += 3;
        }
    }
    *out = 0;
    return 1;
}

static int mount_matches(FILE *fp, const char *expected_root, dev_t device) {
    char line[16384];
    size_t total = 0;
    unsigned matches = 0;
    while (fgets(line, sizeof(line), fp)) {
        size_t len = strlen(line);
        total += len;
        if (!len || line[len - 1] != '\n' || total > 1024 * 1024) return 0;
        line[len - 1] = 0;
        char *fields[256], *save = NULL;
        size_t count = 0;
        for (char *p = strtok_r(line, " ", &save); p; p = strtok_r(NULL, " ", &save)) {
            if (count == 256) return 0;
            fields[count++] = p;
        }
        if (count < 10) return 0;
        unsigned long id, parent, maj, min;
        if (!decimal(fields[0], &id) || !id || !decimal(fields[1], &parent)) return 0;
        char *colon = strchr(fields[2], ':');
        if (!colon) return 0;
        *colon = 0;
        if (!decimal(fields[2], &maj) || !decimal(colon + 1, &min)) return 0;
        size_t sep = 6;
        while (sep < count && strcmp(fields[sep], "-")) sep++;
        if (sep + 4 != count || !unescape(fields[3]) || !unescape(fields[4])) return 0;
        if (!strncmp(fields[4], DATA "/", strlen(DATA) + 1)) return 0;
        if (strcmp(fields[4], DATA)) continue;
        if (++matches != 1 || strcmp(fields[3], expected_root) ||
            strcmp(fields[sep + 1], "ext4") || major(device) != maj || minor(device) != min)
            return 0;
    }
    return !ferror(fp) && matches == 1;
}

static int same_stat(const struct stat *a, const struct stat *b) {
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
           a->st_uid == b->st_uid && a->st_gid == b->st_gid && a->st_mode == b->st_mode;
}

/* Walk with directory-relative O_NOFOLLOW opens, including all fixed ancestors. */
static int open_data(void) {
    int fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return -1;
    const char *parts[] = {"var", "lib", "postgresql", "data"};
    for (size_t i = 0; i <= 4; i++) {
        struct stat st;
        if (fstat(fd, &st) || (st.st_mode & 0022) || (st.st_mode & 07000)) {
            close(fd);
            return -1;
        }
        if (i == 4) return fd;
        int next = openat(fd, parts[i], O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
        close(fd);
        if (next < 0) return -1;
        fd = next;
    }
    return -1;
}

static int data_stat(int fd, struct stat *st) {
    return !fstat(fd, st) && st->st_uid == geteuid() &&
           ((st->st_mode & 07777) == 0700 || (st->st_mode & 07777) == 0750);
}

/* The official entrypoint may create the absent child, never follow a symlink,
 * existing non-directory, wrong-owner/mode child, or a mounted child elsewhere. */
static int child_stat(int fd, struct stat *st, int *present) {
    if (fstatat(fd, "pgdata", st, AT_SYMLINK_NOFOLLOW)) {
        *present = 0;
        return errno == ENOENT;
    }
    *present = 1;
    struct stat parent;
    return !fstat(fd, &parent) && S_ISDIR(st->st_mode) && st->st_dev == parent.st_dev &&
           st->st_uid == geteuid() &&
           ((st->st_mode & 07777) == 0700 || (st->st_mode & 07777) == 0750);
}

static int kernel_matches(int fd, const unsigned char expected[16], const char *root) {
    struct statfs fs;
    struct stat st;
    struct uuid_payload uuid = {.header = {.len = 16, .flags = 0}, .bytes = {0}};
    if (fstatfs(fd, &fs) || fs.f_type != EXT4_MAGIC || fstat(fd, &st) ||
        ioctl(fd, GETFSUUID, &uuid) || uuid.header.len != 16 || uuid.header.flags ||
        memcmp(uuid.bytes, expected, 16)) return 0;
    FILE *fp = fopen("/proc/self/mountinfo", "re");
    if (!fp) return 0;
    int ok = mount_matches(fp, root, st.st_dev);
    if (fclose(fp)) ok = 0;
    return ok;
}

int main(int argc, char **argv) {
    int check = argc == 2 && !strcmp(argv[1], "--check");
    if (!check && !(argc == 2 && !strcmp(argv[1], "postgres"))) return refuse();
    const char *mount = getenv("POSTGRES_HDD_MOUNT"), *data = getenv("POSTGRES_DATA_DIR");
    const char *uid = getenv("POSTGRES_DATA_UID"), *pgdata = getenv("PGDATA");
    unsigned char expected[16];
    unsigned long owner;
    if (!geteuid() || !decimal(uid, &owner) || !owner || owner == UINT32_MAX ||
        uid[0] == '0' || owner != geteuid() || !pgdata || strcmp(pgdata, PGDATA_PATH) ||
        !normal_path(mount) || !normal_path(data) ||
        strncmp(data, mount, strlen(mount)) || data[strlen(mount)] != '/' ||
        !uuid_parse(getenv("POSTGRES_HDD_UUID"), expected)) return refuse();
    const char *root = data + strlen(mount);
    int fd = open_data();
    if (fd < 0) return refuse();
    struct stat before, child_before, after, child_after;
    int had_child, has_child;
    int ok = data_stat(fd, &before) && child_stat(fd, &child_before, &had_child) &&
             kernel_matches(fd, expected, root);
    int again = ok ? open_data() : -1;
    ok = ok && again >= 0 && data_stat(again, &after) && same_stat(&before, &after) &&
         child_stat(again, &child_after, &has_child) && had_child == has_child &&
         (!had_child || same_stat(&child_before, &child_after)) &&
         kernel_matches(again, expected, root);
    if (again >= 0) close(again);
    close(fd);
    if (!ok) return refuse();
    if (check) return 0;
    char *const command[] = {"/usr/local/bin/docker-entrypoint.sh", "postgres", NULL};
    execv(command[0], command);
    return refuse();
}
