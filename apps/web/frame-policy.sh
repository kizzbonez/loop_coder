#!/bin/sh
# Which sites may show Loop Coder inside an iframe, from FRAME_ANCESTORS (see .env.example).
# Runs at container start (/docker-entrypoint.d) and writes /tmp/nginx/frame-policy.conf,
# which nginx.conf includes. Invalid values stop the container instead of weakening the policy.
set -eu
set -f # FRAME_ANCESTORS may contain "*." wildcards; never expand them as file names.

out_dir=/tmp/nginx
policy=""
for source in ${FRAME_ANCESTORS:-none}; do
  case "$source" in
    none | "'none'") source="'none'" ;;
    self | "'self'") source="'self'" ;;
    https://*) ;;
    http://localhost | http://localhost:* | http://127.0.0.1 | http://127.0.0.1:*) ;;
    *)
      echo "FRAME_ANCESTORS: \"$source\" is not allowed. Use none, self, or https:// origins such as https://example.com or https://*.example.com." >&2
      exit 1
      ;;
  esac
  # Origins only: a host with an optional "*." subdomain wildcard and port. No paths or quotes.
  case "$source" in
    "'none'" | "'self'") ;;
    *)
      if ! printf '%s\n' "$source" | grep -Eq '^https?://(\*\.)?[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]{1,5})?$'; then
        echo "FRAME_ANCESTORS: \"$source\" is not a valid origin (expected e.g. https://example.com or https://*.example.com)." >&2
        exit 1
      fi
      ;;
  esac
  policy="${policy:+$policy }$source"
done

# Only spaces in FRAME_ANCESTORS: same as unset.
[ -n "$policy" ] || policy="'none'"

case " $policy " in
  *" 'none' "*)
    if [ "$policy" != "'none'" ]; then
      echo "FRAME_ANCESTORS: \"none\" cannot be combined with other sources." >&2
      exit 1
    fi
    ;;
esac

mkdir -p "$out_dir"
{
  echo "# Generated at container start from FRAME_ANCESTORS."
  echo "set \$frame_ancestors \"$policy\";"
  # X-Frame-Options cannot list other sites; send it (for old browsers) only when it matches.
  if [ "$policy" = "'none'" ]; then
    echo 'add_header X-Frame-Options "DENY" always;'
  elif [ "$policy" = "'self'" ]; then
    echo 'add_header X-Frame-Options "SAMEORIGIN" always;'
  fi
} > "$out_dir/frame-policy.conf"

echo "Loop Coder: frame-ancestors $policy"
