# Official-base minimal derivative: only remove the low-port executable capability.
# Nonroot + ALL-cap-drop + no-new-privileges uses unprivileged internal8445.
FROM caddy:2.11.7-alpine@sha256:84058f1a0e5beb97664a9b79dcfd267b594c033d5bb88d8463cdfb59c0779197
RUN setcap -r /usr/bin/caddy
