import org.jd.core.v1.ClassFileToJavaSourceDecompiler;
import org.jd.core.v1.api.loader.Loader;
import org.jd.core.v1.api.loader.LoaderException;
import org.jd.core.v1.api.printer.Printer;
import java.io.*;
import java.nio.file.*;

public class DecompilerCLI {
    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.out.println("Usage: java -cp \".;jd-core-1.0.7.jar\" DecompilerCLI <class_file_path> <output_java_path>");
            return;
        }
        
        final File classFile = new File(args[0]);
        String outputFile = args[1];
        
        Loader loader = new Loader() {
            @Override
            public byte[] load(String internalName) throws LoaderException {
                try {
                    // 简单的加载逻辑：直接从传入的文件路径读取
                    return Files.readAllBytes(classFile.toPath());
                } catch (IOException e) {
                    throw new LoaderException(e);
                }
            }

            @Override
            public boolean canLoad(String internalName) {
                return classFile.exists();
            }
        };

        Printer printer = new Printer() {
            protected int indentationCount = 0;
            protected StringBuilder sb = new StringBuilder();

            @Override public String toString() { return sb.toString(); }
            @Override public void start(int maxLineNumber, int majorVersion, int minorVersion) {}
            @Override public void end() {}
            @Override public void printText(String text) { sb.append(text); }
            @Override public void printNumericConstant(String constant) { sb.append(constant); }
            @Override public void printStringConstant(String constant, String ownerInternalName) { sb.append(constant); }
            @Override public void printKeyword(String keyword) { sb.append(keyword); }
            @Override public void printDeclaration(int type, String internalTypeName, String name, String descriptor) { sb.append(name); }
            @Override public void printReference(int type, String internalTypeName, String name, String descriptor, String ownerInternalName) { sb.append(name); }
            @Override public void indent() { this.indentationCount++; }
            @Override public void unindent() { this.indentationCount--; }
            @Override public void startLine(int lineNumber) { for (int i=0; i<indentationCount; i++) sb.append("    "); }
            @Override public void endLine() { sb.append("\n"); }
            @Override public void extraLine(int count) { while (count-- > 0) sb.append("\n"); }
            @Override public void startMarker(int type) {}
            @Override public void endMarker(int type) {}
        };

        ClassFileToJavaSourceDecompiler decompiler = new ClassFileToJavaSourceDecompiler();
        // internalName 对单文件反编译不重要，但需要传一个
        decompiler.decompile(loader, printer, "InternalName");

        Files.write(Paths.get(outputFile), printer.toString().getBytes("UTF-8"));
        System.out.println("Decompiled: " + args[0] + " -> " + args[1]);
    }
}
