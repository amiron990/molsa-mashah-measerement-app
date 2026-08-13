#!/usr/bin/env bash
# ============================================================================
#  פריסת הכלי כאתר סטטי בענן שמוגש ב-HTTP
#
#  למה: הדשבורד ב-biportal מוגש ב-HTTP, ודפדפן חוסם הטמעת HTTP בתוך דף HTTPS.
#  Azure Static Web Apps מחייב HTTPS ואי אפשר לכבות זאת; Azure Storage static
#  website כן מאפשר HTTP, ברגע ש-"Secure transfer required" מכובה.
#
#  איפה מריצים: Azure Cloud Shell (bash) — https://portal.azure.com → סמל ה->_
#  אין צורך להתקין דבר. שם:
#
#      git clone https://github.com/amiron990/molsa-mashah-measerement-app.git
#      cd molsa-mashah-measerement-app
#      bash tools/deploy-http-storage.sh
#
#  הסקריפט עובר על המנויים עד שאחד מהם מצליח. לכפיית מנוי מסוים:
#      SUB="<מזהה המנוי>" bash tools/deploy-http-storage.sh
#
#  לעדכון האתר בעתיד — git pull והרצה חוזרת. הכתובת נשארת זהה.
# ============================================================================
set -uo pipefail

RG="${RG:-rg-molsa-workshop}"
LOC="${LOC:-westeurope}"

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> אוסף את קובצי האתר"
cp "$SRC/index.html" "$SRC/workshop.html" "$STAGE/" || exit 1
mkdir -p "$STAGE/assets"
cp "$SRC/assets/"*.css "$SRC/assets/"*.js "$STAGE/assets/" || exit 1

# ---- ניסיון פריסה למנוי אחד ------------------------------------------------
# מחזיר 0 בהצלחה. כל כישלון מחזיר 1, והקורא ממשיך למנוי הבא.
deploy_to() {
  local sub="$1" name reg existing sa key web

  az account set --subscription "$sub" 2>/dev/null || return 1
  az group list --query "[0].name" -o tsv >/dev/null 2>&1 || return 1
  name="$(az account show --query name -o tsv 2>/dev/null)" || return 1
  echo
  echo "==> מנוי: $name ($sub)"

  # בלי ספק המשאבים הזה יצירת חשבון אחסון נכשלת עם SubscriptionNotFound —
  # שגיאה מבלבלת שאין לה קשר לקיום המנוי.
  reg="$(az provider show --namespace Microsoft.Storage --query registrationState -o tsv 2>/dev/null)"
  if [ "$reg" != "Registered" ]; then
    echo "    רושם את ספק המשאבים Microsoft.Storage (עשוי לקחת דקה או שתיים)"
    az provider register --namespace Microsoft.Storage --wait >/dev/null 2>&1 || {
      echo "    לא ניתן לרשום את Microsoft.Storage במנוי הזה"; return 1; }
  fi

  echo "    קבוצת משאבים: $RG ($LOC)"
  az group create -n "$RG" -l "$LOC" -o none 2>/dev/null || return 1

  # בהרצה חוזרת משתמשים בחשבון האחסון הקיים, כדי שכתובת האתר לא תשתנה
  existing="$(az storage account list -g "$RG" --query '[0].name' -o tsv 2>/dev/null)"
  sa="${SA:-${existing:-molsaworkshop$(date +%s | tail -c 6)}}"

  if [ -n "$existing" ] && [ "$sa" = "$existing" ]; then
    echo "    חשבון אחסון קיים: $sa — מעדכן את התוכן"
  else
    echo "    יוצר חשבון אחסון: $sa — עם HTTP מאופשר"
    az storage account create --name "$sa" --resource-group "$RG" --location "$LOC" \
      --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 \
      --https-only false --allow-blob-public-access true -o none 2>/dev/null || {
      echo "    יצירת חשבון האחסון נכשלה"; return 1; }
  fi

  key="$(az storage account keys list -n "$sa" -g "$RG" --query '[0].value' -o tsv 2>/dev/null)" || return 1
  [ -n "$key" ] || return 1

  echo "    מפעיל אירוח אתר סטטי"
  az storage blob service-properties update --account-name "$sa" --account-key "$key" \
    --static-website --index-document index.html --404-document index.html -o none 2>/dev/null || return 1

  echo "    מעלה את הקבצים"
  az storage blob upload-batch --account-name "$sa" --account-key "$key" \
    --source "$STAGE" --destination '$web' --overwrite \
    --content-cache-control 'no-cache' -o none 2>/dev/null || return 1

  web="$(az storage account show -n "$sa" -g "$RG" --query 'primaryEndpoints.web' -o tsv 2>/dev/null)" || return 1
  OK_URL="http://${web#https://}"
  OK_RG="$RG"
  OK_SA="$sa"
  return 0
}

# ---- מעבר על המנויים עד שאחד מצליח -----------------------------------------
OK_URL=""; OK_RG=""; OK_SA=""
if [ -n "${SUB:-}" ]; then
  CANDIDATES="$SUB"
else
  CANDIDATES="$(az account show --query id -o tsv 2>/dev/null) $(az account list --query "[?state=='Enabled'].id" -o tsv 2>/dev/null)"
fi

TRIED=""
for c in $CANDIDATES; do
  case " $TRIED " in *" $c "*) continue ;; esac
  TRIED="$TRIED $c"
  if deploy_to "$c"; then break; fi
done

if [ -z "$OK_URL" ]; then
  cat >&2 <<'ERR'

הפריסה נכשלה בכל המנויים שנוסו. הסיבות הנפוצות:

  • ההזדהות פגה               →  az login
  • אין הרשאת Contributor      →  לבקש הרשאה, או מנוי אחר
  • Azure Policy אוסר אחסון ללא Secure transfer  →  חריג מצוות הענן

לבדיקה ידנית של מנוי מסוים:

    az account set --subscription "<מזהה>"
    az group create -n rg-molsa-workshop -l westeurope

ERR
  exit 1
fi

cat <<EOF

============================================================================
 האתר עלה. הכתובת ב-HTTP — זו שבה ההטמעה של הדשבורד עובדת:

   ${OK_URL}index.html
   ${OK_URL}workshop.html

 שימו לב: הכתובת ציבורית וללא הצפנה. כדי להגביל גישה לכתובות ה-IP של המשרד
 בלבד (מומלץ), הריצו — עם טווחי ה-IP היוצאים של הארגון:

   az storage account network-rule add -g $OK_RG --account-name $OK_SA --ip-address <IP-או-CIDR>
   az storage account update -g $OK_RG -n $OK_SA --default-action Deny

 למחיקת הכל בסיום:

   az group delete -n $OK_RG --yes --no-wait
============================================================================
EOF
