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
#  לבחירת מנוי מסוים:  SUB="<שם או מזהה>" bash tools/deploy-http-storage.sh
#  לעדכון האתר בעתיד — git pull והרצה חוזרת. הכתובת נשארת זהה.
# ============================================================================
set -euo pipefail

RG="${RG:-rg-molsa-workshop}"
LOC="${LOC:-westeurope}"

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"

# ---- המנוי הפעיל -----------------------------------------------------------
# המנוי שנבחר כברירת מחדל ב-Cloud Shell אינו תמיד זה שיש בו הרשאות, ולכן בודקים
# מראש במקום להיכשל באמצע עם SubscriptionNotFound.
if [ -n "${SUB:-}" ]; then
  az account set --subscription "$SUB"
fi

# רשימת המנויים ב-CLI מגיעה ממטמון ומכילה לפעמים מנויים שכבר אינם קיימים, ולכן
# בודקים כל אחד בקריאה אמיתית ל-ARM ובוחרים את הראשון שבאמת עונה.
usable() {
  az account set --subscription "$1" 2>/dev/null || return 1
  az group list --query "[0].name" -o tsv >/dev/null 2>&1
}

SUB_ID=""
if [ -n "${SUB:-}" ]; then
  usable "$SUB" && SUB_ID="$SUB"
else
  CUR="$(az account show --query id -o tsv 2>/dev/null || true)"
  for c in $CUR $(az account list --query "[?state=='Enabled'].id" -o tsv 2>/dev/null || true); do
    if usable "$c"; then SUB_ID="$c"; break; fi
  done
fi

if [ -z "$SUB_ID" ]; then
  cat >&2 <<'ERR'

לא נמצא מנוי שאפשר לפרוס אליו. המנויים שרשומים כאן אינם נגישים לחשבון —
בדרך כלל כי ההזדהות פגה, או שהמנוי יושב ב-tenant אחר.

הריצו לפי הסדר:

    az login
    az account list --refresh --output table
    bash tools/deploy-http-storage.sh

אם הטבלה יוצאת ריקה, למשתמש אין מנוי ב-tenant הזה. בפורטל, בתפריט המשתמש
למעלה מימין, החליפו Directory ל-tenant שבו נמצא המנוי, אתחלו את ה-Cloud Shell
והריצו שוב.
ERR
  exit 1
fi

SUB_NAME="$(az account show --query name -o tsv)"
echo "==> מנוי: $SUB_NAME ($SUB_ID)"
echo "    (לבחירת מנוי אחר: SUB=\"<מזהה המנוי>\" bash tools/deploy-http-storage.sh)"

# ספק המשאבים של Storage חייב להיות רשום במנוי, אחרת יצירת חשבון האחסון נכשלת
# עם SubscriptionNotFound — שגיאה מבלבלת שאין לה קשר לקיום המנוי.
REG="$(az provider show --namespace Microsoft.Storage --query registrationState -o tsv 2>/dev/null || echo NotRegistered)"
if [ "$REG" != "Registered" ]; then
  echo "==> רושם את ספק המשאבים Microsoft.Storage (פעם אחת, עשוי לקחת דקה או שתיים)"
  az provider register --namespace Microsoft.Storage --wait
fi

echo "==> אוסף את קובצי האתר"
cp "$SRC/index.html" "$SRC/workshop.html" "$STAGE/"
mkdir -p "$STAGE/assets"
cp "$SRC/assets/"*.css "$SRC/assets/"*.js "$STAGE/assets/"

echo "==> קבוצת משאבים: $RG ($LOC)"
az group create -n "$RG" -l "$LOC" -o none

# בהרצה חוזרת משתמשים בחשבון האחסון הקיים, כדי שכתובת האתר לא תשתנה
EXISTING="$(az storage account list -g "$RG" --query '[0].name' -o tsv 2>/dev/null || true)"
SA="${SA:-${EXISTING:-molsaworkshop$(date +%s | tail -c 6)}}"

if [ "$SA" = "${EXISTING:-}" ]; then
  echo "==> חשבון אחסון קיים: $SA — מעדכן את התוכן"
else
  echo "==> יוצר חשבון אחסון: $SA — עם HTTP מאופשר"
  az storage account create --name "$SA" --resource-group "$RG" --location "$LOC" --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --https-only false --allow-blob-public-access true -o none
fi

KEY="$(az storage account keys list -n "$SA" -g "$RG" --query '[0].value' -o tsv)"

echo "==> מפעיל אירוח אתר סטטי"
az storage blob service-properties update --account-name "$SA" --account-key "$KEY" --static-website --index-document index.html --404-document index.html -o none

echo "==> מעלה את הקבצים"
az storage blob upload-batch --account-name "$SA" --account-key "$KEY" --source "$STAGE" --destination '$web' --overwrite --content-cache-control 'no-cache' -o none

rm -rf "$STAGE"

WEB="$(az storage account show -n "$SA" -g "$RG" --query 'primaryEndpoints.web' -o tsv)"
HTTP_URL="http://${WEB#https://}"

cat <<EOF

============================================================================
 האתר עלה. הכתובת ב-HTTP — זו שבה ההטמעה של הדשבורד עובדת:

   ${HTTP_URL}index.html
   ${HTTP_URL}workshop.html

 שימו לב: הכתובת ציבורית וללא הצפנה. כדי להגביל גישה לכתובות ה-IP של המשרד
 בלבד (מומלץ), הריצו — עם טווחי ה-IP היוצאים של הארגון:

   az storage account network-rule add -g $RG --account-name $SA --ip-address <IP-או-CIDR>
   az storage account update -g $RG -n $SA --default-action Deny

 למחיקת הכל בסיום:

   az group delete -n $RG --yes --no-wait
============================================================================
EOF
