import os
import subprocess

def convert_images(directory):
    """
    Scans the specified directory for .jpeg files and converts them to .webp
    using the cwebp command line tool.
    """
    # Verify that the directory exists
    if not os.path.exists(directory):
        print(f"Error: The directory '{directory}' does not exist.")
        return

    # List all files in the directory
    files = os.listdir(directory)
    
    # Filter for .jpeg files
    jpeg_files = [f for f in files if f.lower().endswith('.jpeg')]

    if not jpeg_files:
        print("No .jpeg files found in the directory.")
        return

    print(f"Found {len(jpeg_files)} .jpeg files. Starting conversion...\n")

    for filename in jpeg_files:
        # Construct full file paths
        input_path = os.path.join(directory, filename)
        
        # Create the output filename by replacing the extension
        # os.path.splitext separates the filename from the extension
        name_without_ext = os.path.splitext(filename)[0]
        output_filename = f"{name_without_ext}.webp"
        output_path = os.path.join(directory, output_filename)

        # Construct the cwebp command
        # Matches your example: cwebp -q 90 input.jpeg -o output.webp
        command = [
            "cwebp",
            "-q", "90",
            input_path,
            "-o", output_path
        ]

        try:
            # Run the command
            print(f"Converting: {filename} -> {output_filename}")
            subprocess.run(command, check=True)
        except subprocess.CalledProcessError as e:
            print(f"Error converting {filename}: {e}")
        except FileNotFoundError:
            print("Error: The 'cwebp' tool was not found. Please ensure it is installed and in your PATH.")
            return

    print("\nProcessing complete.")

if __name__ == "__main__":
    # The specific folder path provided in your request
    target_folder = "/Users/yairben-dor/XCode/CatalystMagazine/postimages"
    
    convert_images(target_folder)
