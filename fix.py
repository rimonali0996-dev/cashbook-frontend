import re
import traceback

def fix():
    try:
        with open(r"h:\Google Drive\cashbook\src\App.jsx", "r", encoding="utf-8") as f:
            content = f.read()

        print("Read file length:", len(content))

        # 1. Extract Inventory Tab
        # The exact text to remove:
        inventory_pattern = re.compile(r'(        {/\* WALLET INVENTORY TAB \*/}.*?)        {/\* ================= REGISTRATION VIEW ================= \*/}', re.DOTALL)
        match = inventory_pattern.search(content)
        if not match:
            print("Inventory pattern not found!")
            return
        inventory_block = match.group(1)
        print("Found inventory block length:", len(inventory_block))

        # Remove inventory block from original location
        content = content.replace(inventory_block, "")
        
        # 2. Insert inventory_block inside DASHBOARD VIEW right before ENTRY VIEW
        entry_marker = "              {/* ================= ENTRY VIEW ================= */}"
        if entry_marker not in content:
            print("ENTRY VIEW marker not found!")
            return
            
        content = content.replace(entry_marker, inventory_block + "\n" + entry_marker)
        print("Inserted inventory block.")

        # 3. Move ENTRY VIEW outside of DASHBOARD VIEW
        # Find ENTRY VIEW block and the closing tags of Dashboard view
        # We know DASHBOARD VIEW has 
        #         </div>
        #       )}
        
        entry_pattern = re.compile(r'(              {/\* ================= ENTRY VIEW ================= \*/}.*?              \)}\n\n)(            </div>\n          \)})', re.DOTALL)
        match2 = entry_pattern.search(content)
        if not match2:
            print("Entry pattern not found! Trying alternative pattern.")
            # Let's inspect the actual content around the end of ENTRY VIEW
            entry_alt = re.compile(r'(              {/\* ================= ENTRY VIEW ================= \*/}.*?              \)}\n\n            </div>\n          \)\})', re.DOTALL)
            match_alt = entry_alt.search(content)
            if not match_alt:
                print("Alt pattern not found either. Saving modified content so far for inspection.")
                with open(r"h:\Google Drive\cashbook\src\App.js.tmp", "w", encoding="utf-8") as f:
                    f.write(content)
                return
            else:
                full_block = match_alt.group(1)
                print("Found alt block.")
                return
            
        entry_block = match2.group(1)
        closing_dashboard = match2.group(2)
        print("Found entry block length:", len(entry_block))
        
        # Remove entry block from inside dashboard
        content = content.replace(entry_block, "")
        
        # And place it AFTER closing dashboard
        content = content.replace(closing_dashboard, closing_dashboard + "\n\n" + entry_block)
        print("Moved entry block out of dashboard view.")

        with open(r"h:\Google Drive\cashbook\src\App.jsx", "w", encoding="utf-8") as f:
            f.write(content)
            
        print("Fixed App.jsx successfully.")
    except Exception as e:
        traceback.print_exc()

fix()
